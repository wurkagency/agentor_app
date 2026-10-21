'use server';

import {
  approveSupportInvoice,
  getPlatformSettings,
  isUuid,
  logFinanceAction,
  notifyInvoice,
  PlatformError,
  saveSupportDrafts,
  setDraftTimelog,
  setSubscriptionDiscount,
} from '@agentor/db';
import type { Locale } from '@agentor/i18n';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { reportCsv } from '@/server/finance-export';
import { financeInvoicesAll, financeSubs, monthReport, parseMonth } from '@/server/finance-data';
import { db } from '@/server/infra';
import { brandName } from '@/components/billing/card';
import { appLink, sendEmail } from '@/server/mail';
import { requireStaff } from '@/server/platform';

/**
 * Finans actions (F2–F7). Superadmin only: every action checks the role here and again in the
 * database, and every change is written to the customer's audit log.
 */

function fail(e: unknown): ActionResult<never> {
  if (e instanceof PlatformError) return { ok: false, error: e.code };
  const msg =
    e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
  for (const code of ['NOT_SUPERADMIN', 'NOT_FOUND', 'INVALID'])
    if (msg.includes(code)) return { ok: false, error: code };
  throw e;
}

const uuid = z.string().refine(isUuid);

export async function setDiscountAction(input: {
  tenantId: string;
  pct: number | null;
  until: string | null;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({
      tenantId: uuid,
      pct: z.number().int().min(1).max(100).nullable(),
      until: z.iso.date().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await setSubscriptionDiscount(
      db(),
      actor,
      parsed.data.tenantId,
      parsed.data.pct,
      parsed.data.until ? new Date(`${parsed.data.until}T23:59:59+01:00`) : null,
    );
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true };
}

/** "Forhåndsvis fakturaer" (F3): builds or refreshes the month's support drafts. */
export async function buildDraftsAction(month: string): Promise<ActionResult<{ drafts: number }>> {
  const { actor } = await requireStaff(true);
  const m = parseMonth(month);
  try {
    const res = await saveSupportDrafts(db(), actor, m.year, m.month);
    revalidatePath('/platform/finance', 'layout');
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** "Godkend" (F5): the draft is numbered and sent or charged on the 1st at 08:00. */
export async function approveInvoiceAction(input: {
  tenantId: string;
  invoiceId: string;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!isUuid(input.tenantId) || !isUuid(input.invoiceId)) return { ok: false, error: 'invalid' };
  try {
    await approveSupportInvoice(db(), actor, input.tenantId, input.invoiceId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true };
}

/**
 * "Send rykker" and "Send betalingslink" (F6). The link goes to the customer's own
 * Abonnement page, where the owner updates the card; the next retry then charges it.
 */
export async function notifyInvoiceAction(input: {
  tenantId: string;
  invoiceId: string;
  kind: 'reminder' | 'payment_link';
}): Promise<ActionResult<{ email: string }>> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({ tenantId: uuid, invoiceId: uuid, kind: z.enum(['reminder', 'payment_link']) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  let contact;
  try {
    contact = await notifyInvoice(
      db(),
      actor,
      parsed.data.tenantId,
      parsed.data.invoiceId,
      parsed.data.kind,
    );
  } catch (e) {
    return fail(e);
  }
  if (!contact) return { ok: false, error: 'NOT_FOUND' };
  if (!contact.email) return { ok: false, error: 'NO_EMAIL' };
  const locale = (await getLocale()) as Locale;
  const ref = `invoice-${parsed.data.invoiceId}`;
  if (parsed.data.kind === 'reminder') {
    // E15; the second and later reminders say so in the subject.
    await sendEmail(
      'invoice-reminder',
      {
        company: contact.tenantName,
        number: contact.number ?? '',
        grossOre: contact.grossOre,
        dueAt: contact.dueAt ?? new Date(),
        reminder: Math.max(1, contact.reminders),
        url: appLink(`/billing/invoices/${parsed.data.invoiceId}/pdf`),
        billingEmail: contact.email,
      },
      { to: contact.email, locale, entityRef: `${ref}-reminder-${contact.reminders}` },
    );
  } else {
    // E16: the button opens the owner's card page, which starts QuickPay's hosted form.
    const [subs, invoices] = await Promise.all([financeSubs(actor), financeInvoicesAll(actor)]);
    const sub = subs.find((x) => x.tenantId === parsed.data.tenantId);
    const inv = invoices.find((x) => x.id === parsed.data.invoiceId);
    await sendEmail(
      'update-card',
      {
        company: contact.tenantName,
        number: contact.number ?? '',
        grossOre: contact.grossOre,
        card: sub?.cardLast4 ? `${brandName(sub.cardBrand)} •••• ${sub.cardLast4}` : null,
        detail: inv?.description ?? null,
        url: appLink('/billing/payment'),
        billingEmail: contact.email,
      },
      { to: contact.email, locale, entityRef: `${ref}-card` },
    );
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true, data: { email: contact.email } };
}

/** "Send til bogholder" (F7): the month's report as CSV to the bookkeeper. */
export async function sendReportAction(month: string): Promise<ActionResult<{ email: string }>> {
  const { actor } = await requireStaff(true);
  const settings = await getPlatformSettings(db(), actor.userId);
  if (!settings.bookkeeperEmail) return { ok: false, error: 'NO_BOOKKEEPER' };
  const m = parseMonth(month);
  const [csv, r] = await Promise.all([reportCsv(actor, m), monthReport(actor, m)]);
  const filename = `agentor-finans-${m.key}.csv`;
  // E18: internal, to the bookkeeper, with the CSV attached.
  await sendEmail(
    'monthly-report',
    {
      month: m.key,
      revenueOre: r.revenueOre,
      subscriptionsOre: r.subscriptionOre,
      supportOre: r.supportOre,
      filename,
      bytes: Buffer.byteLength(csv, 'utf8'),
    },
    {
      to: settings.bookkeeperEmail,
      attachments: [{ filename, content: csv, contentType: 'text/csv' }],
      entityRef: `report-${m.key}`,
    },
  );
  return { ok: true, data: { email: settings.bookkeeperEmail } };
}

/** "Send kontoudtog" (F4): the customer's open invoices to the billing e-mail. */
export async function sendStatementAction(
  tenantId: string,
): Promise<ActionResult<{ email: string }>> {
  const { actor } = await requireStaff(true);
  if (!isUuid(tenantId)) return { ok: false, error: 'invalid' };
  const [subs, invoices] = await Promise.all([financeSubs(actor), financeInvoicesAll(actor)]);
  const sub = subs.find((s) => s.tenantId === tenantId);
  if (!sub) return { ok: false, error: 'NOT_FOUND' };
  if (!sub.billingEmail) return { ok: false, error: 'NO_EMAIL' };
  const locale = (await getLocale()) as Locale;
  const open = invoices.filter(
    (i) => i.tenantId === tenantId && (i.status === 'open' || i.status === 'failed'),
  );
  // E17: one ledger line per open invoice, or "Ingen åbne poster".
  await sendEmail(
    'account-statement',
    {
      company: sub.tenantName,
      lines: open.map((i) => ({
        number: i.number ?? '',
        description: i.description,
        grossOre: i.grossOre,
        dueAt: i.dueAt,
      })),
      url: appLink('/billing/invoices'),
      billingEmail: sub.billingEmail,
    },
    { to: sub.billingEmail, locale, entityRef: `statement-${tenantId}-${Date.now()}` },
  );
  await logFinanceAction(db(), actor, 'finance.statement_sent', {
    tenantId,
    invoices: open.length,
  });
  return { ok: true, data: { email: sub.billingEmail } };
}

/** F5 "Tilføj linje": a line by hand on the month's support draft, e.g. goodwill (negative). */
export async function addDraftLineAction(input: {
  tenantId: string;
  month: string;
  text: string;
  amountKr: number;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({
      tenantId: uuid,
      month: z.string().regex(/^\d{4}-\d{2}$/),
      text: z.string().trim().min(1).max(200),
      amountKr: z.number().min(-1_000_000).max(1_000_000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const m = parseMonth(parsed.data.month);
  try {
    await saveSupportDrafts(db(), actor, m.year, m.month, {
      tenantId: parsed.data.tenantId,
      addLine: { text: parsed.data.text, amountOre: Math.round(parsed.data.amountKr * 100) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true };
}

export async function removeDraftLineAction(input: {
  tenantId: string;
  month: string;
  index: number;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!isUuid(input.tenantId) || !Number.isInteger(input.index) || input.index < 0)
    return { ok: false, error: 'invalid' };
  const m = parseMonth(input.month);
  try {
    await saveSupportDrafts(db(), actor, m.year, m.month, {
      tenantId: input.tenantId,
      removeLine: input.index,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true };
}

/** F5 "Vedhæft tidslog". */
export async function setTimelogAction(input: {
  tenantId: string;
  invoiceId: string;
  attach: boolean;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!isUuid(input.tenantId) || !isUuid(input.invoiceId)) return { ok: false, error: 'invalid' };
  try {
    await setDraftTimelog(db(), actor, input.tenantId, input.invoiceId, input.attach === true);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/finance', 'layout');
  return { ok: true };
}
