import {
  DEFAULT_SUPPORT_RATE_ORE,
  roundUpQuarter,
  supportLines,
  supportMonth,
  withVat,
  type SupportEntry,
  type SupportLine,
} from '@agentor/core';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { withoutTenant, type Database, type Transaction } from '../client.js';
import {
  cases,
  platformAudit,
  platformSettings,
  timeEntries,
  type BillingInterval,
  type InvoiceKind,
  type InvoiceLine,
  type InvoiceStatus,
  type PaymentMethod,
  type SubscriptionStatus,
} from '../schema/index.js';
import { PlatformError, type StaffActor } from './platform.js';

/**
 * Finans (README decision 18, F1–F7): Superadmin only. Reads and writes go through the
 * app.platform_finance_* functions, which check the role in the database and write every change
 * to the customer's audit log. Supporters never reach any of this.
 */

const asStaff = <T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>) =>
  withoutTenant(db, fn, userId);

function requireSuperadmin(actor: StaffActor) {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
}

const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);

export interface FinanceSubscription {
  id: string;
  tenantId: string;
  tenantName: string;
  cvr: string | null;
  billingEmail: string | null;
  customerSince: Date;
  planId: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  paymentMethod: PaymentMethod;
  ean: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpiry: string | null;
  hasProvider: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  trialEndsAt: Date | null;
  cancelAt: Date | null;
  discountPct: number | null;
  discountUntil: Date | null;
  createdAt: Date;
}

export async function financeSubscriptions(
  db: Database,
  actor: StaffActor,
): Promise<FinanceSubscription[]> {
  requireSuperadmin(actor);
  const res = await asStaff(db, actor.userId, (tx) =>
    tx.execute<{ s: Record<string, unknown> }>(
      sql`select s from app.platform_finance_subscriptions() s`,
    ),
  );
  return res.rows.map(({ s }) => ({
    id: s.id as string,
    tenantId: s.tenant_id as string,
    tenantName: s.tenant_name as string,
    cvr: (s.cvr as string | null) ?? null,
    billingEmail: (s.billing_email as string | null) ?? null,
    customerSince: date(s.tenant_created_at)!,
    planId: s.plan_id as string,
    status: s.status as SubscriptionStatus,
    interval: s.interval as BillingInterval,
    paymentMethod: s.payment_method as PaymentMethod,
    ean: (s.ean as string | null) ?? null,
    cardBrand: (s.card_brand as string | null) ?? null,
    cardLast4: (s.card_last4 as string | null) ?? null,
    cardExpiry: (s.card_expiry as string | null) ?? null,
    hasProvider: Boolean(s.provider_subscription_id),
    currentPeriodStart: date(s.current_period_start),
    currentPeriodEnd: date(s.current_period_end),
    pastDueSince: date(s.past_due_since),
    trialEndsAt: date(s.trial_ends_at),
    cancelAt: date(s.cancel_at),
    discountPct: (s.discount_pct as number | null) ?? null,
    discountUntil: date(s.discount_until),
    createdAt: date(s.created_at)!,
  }));
}

export interface FinanceInvoice {
  id: string;
  tenantId: string;
  tenantName: string;
  cvr: string | null;
  number: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  description: string;
  lines: InvoiceLine[];
  periodStart: Date;
  periodEnd: Date;
  netOre: number;
  vatOre: number;
  grossOre: number;
  paymentMethod: PaymentMethod;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  sendAt: Date | null;
  attempts: number;
  nextRetryAt: Date | null;
  reminders: number;
  lastReminderAt: Date | null;
  attachTimelog: boolean;
  createdAt: Date;
}

/** Invoices issued (or drafted) in [from, to), all customers. */
export async function financeInvoices(
  db: Database,
  actor: StaffActor,
  from: Date,
  to: Date,
): Promise<FinanceInvoice[]> {
  requireSuperadmin(actor);
  const res = await asStaff(db, actor.userId, (tx) =>
    tx.execute<{ i: Record<string, unknown> }>(
      sql`select i from app.platform_finance_invoices(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz) i`,
    ),
  );
  return res.rows.map(({ i }) => {
    const net = i.amount_ore as number;
    const vat = i.vat_ore as number;
    return {
      id: i.id as string,
      tenantId: i.tenant_id as string,
      tenantName: i.tenant_name as string,
      cvr: (i.cvr as string | null) ?? null,
      number: (i.number as string | null) ?? null,
      kind: i.kind as InvoiceKind,
      status: i.status as InvoiceStatus,
      description: i.description as string,
      lines: (i.lines as InvoiceLine[]) ?? [],
      periodStart: date(i.period_start)!,
      periodEnd: date(i.period_end)!,
      netOre: net,
      vatOre: vat,
      grossOre: net + vat,
      paymentMethod: i.payment_method as PaymentMethod,
      issuedAt: date(i.issued_at),
      dueAt: date(i.due_at),
      paidAt: date(i.paid_at),
      approvedAt: date(i.approved_at),
      approvedByName: (i.approved_by_name as string | null) ?? null,
      sendAt: date(i.send_at),
      attempts: (i.attempts as number) ?? 0,
      nextRetryAt: date(i.next_retry_at),
      reminders: (i.reminders as number) ?? 0,
      lastReminderAt: date(i.last_reminder_at),
      attachTimelog: i.attach_timelog !== false,
      createdAt: date(i.created_at)!,
    };
  });
}

/* ---- Support time (F3, F5) -------------------------------------------------------------------- */

export interface FinanceTimeEntry extends SupportEntry {
  tenantId: string;
  staffUserId: string;
  staffName: string;
  invoiceId: string | null;
  caseStatus: string | null;
  caseResolvedAt: Date | null;
}

/** All support time in a date range (Copenhagen work dates, inclusive). */
export async function financeTime(
  db: Database,
  actor: StaffActor,
  firstDay: string,
  lastDay: string,
): Promise<FinanceTimeEntry[]> {
  requireSuperadmin(actor);
  const rows = await asStaff(db, actor.userId, (tx) =>
    tx
      .select({
        id: timeEntries.id,
        tenantId: timeEntries.tenantId,
        staffUserId: timeEntries.staffUserId,
        staffName: timeEntries.staffName,
        caseId: timeEntries.caseId,
        caseNumber: cases.number,
        caseTitle: cases.title,
        caseStatus: cases.status,
        caseResolvedAt: cases.resolvedAt,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        workDate: timeEntries.workDate,
        source: timeEntries.source,
        invoiceId: timeEntries.invoiceId,
      })
      .from(timeEntries)
      .leftJoin(cases, eq(cases.id, timeEntries.caseId))
      .where(and(gte(timeEntries.workDate, firstDay), lte(timeEntries.workDate, lastDay))),
  );
  return rows
    .filter((r): r is typeof r & { tenantId: string } => r.tenantId !== null)
    .map((r) => ({
      ...r,
      caseNumber: r.caseNumber ?? null,
      caseTitle: r.caseTitle ?? null,
      caseStatus: r.caseStatus ?? null,
      caseResolvedAt: r.caseResolvedAt ?? null,
    }));
}

export async function supportRateOre(db: Database, actor: StaffActor): Promise<number> {
  const [row] = await asStaff(db, actor.userId, (tx) =>
    tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, 'hourlyRateOre')),
  );
  return typeof row?.value === 'number' && row.value > 0 ? row.value : DEFAULT_SUPPORT_RATE_ORE;
}

const MONTHS_DA = [
  'januar',
  'februar',
  'marts',
  'april',
  'maj',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'december',
];

function lineDetail(l: SupportLine): string {
  const d = (s: string) => `${Number(s.slice(8, 10))}.`;
  const days = l.firstDate === l.lastDate ? d(l.firstDate) : `${d(l.firstDate)}–${d(l.lastDate)}`;
  const parts = [];
  if (l.sessions) parts.push(`${l.sessions} ${l.sessions === 1 ? 'session' : 'sessioner'}`);
  if (l.entries) parts.push(`${l.entries} ${l.entries === 1 ? 'registrering' : 'registreringer'}`);
  return `${days} · ${parts.join(' og ')}`;
}

/**
 * Builds or refreshes the support drafts for a month (F3 "Forhåndsvis fakturaer"): one per
 * customer with billable time on a case, plus the lines added by hand (F5 "Tilføj linje"),
 * which a refresh keeps. Approved and sent invoices are left as they are.
 */
export async function saveSupportDrafts(
  db: Database,
  actor: StaffActor,
  year: number,
  month: number,
  opts: {
    tenantId?: string;
    addLine?: { text: string; amountOre: number };
    removeLine?: number;
  } = {},
): Promise<{ drafts: number }> {
  requireSuperadmin(actor);
  const m = supportMonth(year, month);
  const [entries, rate, existing] = await Promise.all([
    financeTime(db, actor, m.firstDay, m.lastDay),
    supportRateOre(db, actor),
    financeInvoices(db, actor, m.start, new Date(Date.now() + 86_400_000)),
  ]);
  const drafts = new Map(
    existing
      .filter(
        (i) =>
          i.kind === 'support' &&
          i.status === 'draft' &&
          !i.approvedAt &&
          i.periodStart.getTime() === m.start.getTime(),
      )
      .map((i) => [i.tenantId, i]),
  );
  const byTenant = new Map<string, FinanceTimeEntry[]>();
  for (const e of entries) byTenant.set(e.tenantId, [...(byTenant.get(e.tenantId) ?? []), e]);
  for (const t of drafts.keys()) if (!byTenant.has(t)) byTenant.set(t, []);
  if (opts.tenantId && !byTenant.has(opts.tenantId)) byTenant.set(opts.tenantId, []);
  let count = 0;
  await asStaff(db, actor.userId, async (tx) => {
    for (const [tenantId, list] of byTenant) {
      if (opts.tenantId && tenantId !== opts.tenantId) continue;
      const lines = supportLines(list, rate);
      let manual = (drafts.get(tenantId)?.lines ?? []).filter((l) => l.manual);
      if (opts.removeLine !== undefined)
        manual = manual.filter((_, idx) => idx !== opts.removeLine);
      if (opts.addLine)
        manual.push({ text: opts.addLine.text, amountOre: opts.addLine.amountOre, manual: true });
      if (lines.length === 0 && manual.length === 0) continue;
      const invoiceLines: InvoiceLine[] = [
        ...lines.map((l) => ({
          text: l.text,
          amountOre: l.amountOre,
          caseId: l.caseId,
          caseNumber: l.caseNumber,
          registeredMinutes: l.registeredMinutes,
          billedMinutes: l.billedMinutes,
          rateOre: l.rateOre,
          detail: lineDetail(l),
          log: list
            .filter((e) => l.entryIds.includes(e.id))
            .sort((a, b) => a.workDate.localeCompare(b.workDate))
            .map((e) => ({
              date: e.workDate,
              registeredMinutes: e.minutes,
              billedMinutes: roundUpQuarter(e.minutes),
            })),
        })),
        ...manual,
      ];
      const net = Math.max(
        0,
        invoiceLines.reduce((a, l) => a + l.amountOre, 0),
      );
      const { vat } = withVat(net);
      await tx.execute(sql`select app.platform_finance_save_draft(
        ${tenantId}::uuid, ${m.start.toISOString()}::timestamptz, ${m.end.toISOString()}::timestamptz,
        ${`Support · ${MONTHS_DA[month - 1]} ${year}`}, ${JSON.stringify(invoiceLines)}::jsonb,
        ${net}::int, ${vat}::int,
        ${`{${lines.flatMap((l) => l.entryIds).join(',')}}`}::uuid[],
        ${m.sendAt.toISOString()}::timestamptz)`);
      count++;
    }
    await tx.insert(platformAudit).values({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: opts.addLine
        ? 'finance.line_added'
        : opts.removeLine !== undefined
          ? 'finance.line_removed'
          : 'finance.drafts_built',
      detail: { year, month, drafts: count, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
    });
  });
  return { drafts: count };
}

/** F5 "Vedhæft tidslog": print the time log on the support invoice, or not. */
export async function setDraftTimelog(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  invoiceId: string,
  attach: boolean,
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, (tx) =>
    tx.execute(
      sql`select app.platform_finance_timelog(${tenantId}::uuid, ${invoiceId}::uuid, ${attach}, ${actor.name})`,
    ),
  );
}

export async function approveSupportInvoice(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  invoiceId: string,
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, async (tx) => {
    try {
      await tx.execute(
        sql`select app.platform_finance_approve(${tenantId}::uuid, ${invoiceId}::uuid, ${actor.name})`,
      );
    } catch (e) {
      if (
        String(e).includes('NOT_FOUND') ||
        String((e as { cause?: unknown }).cause).includes('NOT_FOUND')
      )
        throw new PlatformError('NOT_FOUND');
      throw e;
    }
    await tx.insert(platformAudit).values({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: 'finance.invoice_approved',
      detail: { tenantId, invoiceId },
    });
  });
}

export interface InvoiceContact {
  email: string | null;
  tenantName: string;
  number: string | null;
  grossOre: number;
  dueAt: Date | null;
  reminders: number;
}

/** Records a reminder or payment link and returns where to send it; null if not payable. */
export async function notifyInvoice(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  invoiceId: string,
  kind: 'reminder' | 'payment_link',
): Promise<InvoiceContact | null> {
  requireSuperadmin(actor);
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{
      email: string | null;
      tenant_name: string;
      number: string | null;
      amount_ore: number;
      due_at: string | null;
      reminders: number;
    }>(
      sql`select * from app.platform_finance_notify(${tenantId}::uuid, ${invoiceId}::uuid, ${kind}, ${actor.name})`,
    );
    const r = res.rows[0];
    if (!r) return null;
    await tx.insert(platformAudit).values({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: kind === 'reminder' ? 'finance.reminder_sent' : 'finance.payment_link_sent',
      detail: { tenantId, invoiceId },
    });
    return {
      email: r.email,
      tenantName: r.tenant_name,
      number: r.number,
      grossOre: Number(r.amount_ore),
      dueAt: r.due_at ? new Date(r.due_at) : null,
      reminders: r.reminders,
    };
  });
}

export async function setSubscriptionDiscount(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  pct: number | null,
  until: Date | null,
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, async (tx) => {
    await tx.execute(
      sql`select app.platform_finance_discount(${tenantId}::uuid, ${pct}::int, ${until?.toISOString() ?? null}::timestamptz, ${actor.name})`,
    );
    await tx.insert(platformAudit).values({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: 'finance.discount',
      detail: { tenantId, pct, until: until?.toISOString() ?? null },
    });
  });
}

/** Logs a Finans action that has no row of its own, e.g. a statement sent to a customer. */
export async function logFinanceAction(
  db: Database,
  actor: StaffActor,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, (tx) =>
    tx
      .insert(platformAudit)
      .values({ actorUserId: actor.userId, actorName: actor.name, action, detail }),
  );
}

export const EDITABLE_PLAN_KEYS = [
  'seats',
  'transactions_per_month',
  'integration_sets',
  'destinations_per_flow',
  'polling_interval_minutes',
] as const;

/**
 * Superadmin changes a plan's monthly price and limits (P6 "Ændre planer, priser"). Null in a
 * limit means unlimited. Customers see the change at once; prices apply from the next renewal.
 */
export async function updatePlan(
  db: Database,
  actor: StaffActor,
  planId: string,
  input: {
    priceMonthlyOre: number;
    values: Partial<Record<(typeof EDITABLE_PLAN_KEYS)[number], number | null>>;
  },
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, async (tx) => {
    await tx.execute(
      sql`select app.platform_plan_update(${planId}, ${input.priceMonthlyOre}::int, ${JSON.stringify(input.values)}::jsonb)`,
    );
    await tx.insert(platformAudit).values({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: 'plan.updated',
      detail: { planId, ...input },
    });
  });
}
