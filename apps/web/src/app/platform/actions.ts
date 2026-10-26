'use server';

import {
  activeGrant,
  addCaseEvent,
  addCustomerNote,
  addTime,
  caseRecipients,
  confirmSession,
  createCase,
  disableStaff,
  endAccess,
  followCase,
  getSession,
  isUuid,
  linkSessionTime,
  listCases,
  openSession,
  PlatformError,
  requestAccess,
  requestExtension,
  resolveCase,
  setPlatformSettings,
  startTimer,
  stopTimer,
  superadminAccess,
  updateCase,
  updateTime,
  upsertStaff,
  type CaseEvent,
} from '@agentor/db';
import type { CaseHistoryItem } from '@agentor/email';
import type { Locale } from '@agentor/i18n';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { db } from '@/server/infra';
import { caseReplyAddress } from '@/server/case-reply';
import { sendEmail } from '@/server/mail';
import { requireStaff, SUPPORT_COOKIE } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';

const uuid = z.string().refine(isUuid);

function fail(e: unknown): ActionResult<never> {
  if (e instanceof PlatformError) return { ok: false, error: e.code };
  const msg =
    e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
  for (const code of [
    'SUPPORT_CASE_AND_REASON_REQUIRED',
    'SUPPORT_HOURS',
    'SUPPORT_SCOPE',
    'NOT_STAFF',
  ])
    if (msg.includes(code)) return { ok: false, error: code };
  throw e;
}

/* ---- Support access (P2, P3, P5) -------------------------------------------------------------- */

const accessSchema = z.object({
  tenantId: uuid,
  caseId: uuid.nullable(),
  reason: z.string().trim().min(1).max(500),
  hours: z.union([z.literal(1), z.literal(8), z.literal(24)]),
  scope: z.enum(['view', 'help']),
});

export async function requestAccessAction(
  input: z.input<typeof accessSchema>,
): Promise<ActionResult<{ autoApproved: boolean; grantId: string }>> {
  const { actor } = await requireStaff();
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    const res = await requestAccess(db(), actor, parsed.data);
    revalidatePath('/platform', 'layout');
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** "Åbn kundens app" / ⌘J: starts a support session and shows the customer's app (P4). */
export async function openSupportViewAction(grantId: string): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(grantId)) return { ok: false, error: 'invalid' };
  const grant = await activeGrant(db(), actor.userId, grantId);
  if (!grant) return { ok: false, error: 'NO_ACCESS' };
  const sessionId = await openSession(db(), actor, grant);
  (await cookies()).set(SUPPORT_COOKIE, `${grant.grantId}.${sessionId}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: grant.expiresAt,
  });
  redirect('/');
}

/** Superadmin: open any customer's app directly, without a request (decision of 19 Oct 2026). */
export async function openAsSuperadminAction(tenantId: string): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!isUuid(tenantId)) return { ok: false, error: 'invalid' };
  let grantId: string;
  try {
    grantId = await superadminAccess(db(), actor, tenantId);
  } catch (e) {
    return fail(e);
  }
  return openSupportViewAction(grantId);
}

export async function endAccessAction(tenantId: string, grantId: string): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(tenantId) || !isUuid(grantId)) return { ok: false, error: 'invalid' };
  await endAccess(db(), actor, tenantId, grantId);
  const jar = await cookies();
  if (jar.get(SUPPORT_COOKIE)?.value.startsWith(grantId)) jar.delete(SUPPORT_COOKIE);
  revalidatePath('/platform', 'layout');
  return { ok: true };
}

export async function requestExtensionAction(
  tenantId: string,
  grantId: string,
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(tenantId) || !isUuid(grantId)) return { ok: false, error: 'invalid' };
  await requestExtension(db(), actor, tenantId, grantId);
  return { ok: true };
}

export interface SessionEndInfo {
  sessionId: string;
  grantId: string;
  tenantId: string;
  tenantName: string;
  startedAt: string;
  lastActionAt: string;
  minutes: number;
  actions: { at: string; label: string }[];
  caseId: string | null;
  expiresAt: string;
  cases: { id: string; label: string }[];
}

/** What the "Afslut supportsession" dialog shows (S5). */
export async function supportSessionInfoAction(): Promise<ActionResult<SessionEndInfo>> {
  const { actor } = await requireStaff();
  const raw = (await cookies()).get(SUPPORT_COOKIE)?.value;
  const [grantId, sessionId] = raw?.split('.') ?? [];
  if (!grantId || !sessionId) return { ok: false, error: 'NO_ACCESS' };
  const [session, grant] = await Promise.all([
    getSession(db(), actor.userId, sessionId),
    activeGrant(db(), actor.userId, grantId),
  ]);
  if (!session) return { ok: false, error: 'NOT_FOUND' };
  const names = await tenantNames(actor.userId);
  const open = await listCases(db(), actor.userId, names, {
    tenantId: session.tenantId,
    status: ['new', 'in_progress', 'waiting'],
  });
  return {
    ok: true,
    data: {
      sessionId,
      grantId,
      tenantId: session.tenantId,
      tenantName: names.get(session.tenantId) ?? '',
      startedAt: session.startedAt.toISOString(),
      lastActionAt: session.lastActionAt.toISOString(),
      minutes: session.minutes,
      actions: session.actions,
      caseId: session.caseId,
      expiresAt: (grant?.expiresAt ?? new Date()).toISOString(),
      cases: open.map((c) => ({ id: c.id, label: `#${c.number} ${c.title}` })),
    },
  };
}

const endSchema = z.object({
  minutes: z.number().int().min(1).max(1440),
  caseId: uuid.nullable(),
  summary: z.string().max(500),
  billable: z.boolean(),
  endGrant: z.boolean(),
  discard: z.boolean(),
});

/** "Gem 42 min. på #2291" / "Kassér tid" (S5): leaves the support view. */
export async function endSupportViewAction(
  input: z.input<typeof endSchema>,
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const jar = await cookies();
  const [grantId, sessionId] = jar.get(SUPPORT_COOKIE)?.value.split('.') ?? [];
  if (!grantId || !sessionId) return { ok: false, error: 'NO_ACCESS' };
  const session = await getSession(db(), actor.userId, sessionId);
  if (!session) return { ok: false, error: 'NOT_FOUND' };
  try {
    if (!parsed.data.discard)
      await confirmSession(db(), actor, {
        sessionId,
        minutes: parsed.data.minutes,
        caseId: parsed.data.caseId,
        billable: parsed.data.billable,
        summary: parsed.data.summary,
      });
    else
      await confirmSession(db(), actor, {
        sessionId,
        minutes: 1,
        caseId: null,
        billable: false,
        summary: '',
      }).catch(() => undefined);
    if (parsed.data.endGrant) await endAccess(db(), actor, session.tenantId, grantId);
  } catch (e) {
    return fail(e);
  }
  jar.delete(SUPPORT_COOKIE);
  revalidatePath('/platform', 'layout');
  redirect(
    parsed.data.caseId
      ? `/platform/support/cases/${parsed.data.caseId}`
      : `/platform/customers/${session.tenantId}`,
  );
}

/* ---- Cases (S1–S4, S8) ------------------------------------------------------------------------ */

const statusSchema = z.enum(['new', 'in_progress', 'waiting', 'resolved', 'closed']);
const prioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
const CATEGORIES = [
  'error',
  'mapping',
  'connection',
  'setup',
  'subscription',
  'wish',
  'question',
] as const;

export async function createCaseAction(input: {
  tenantId: string;
  title: string;
  body: string;
  priority: string;
  category: string;
}): Promise<ActionResult<{ id: string }>> {
  const { actor } = await requireStaff();
  const parsed = z
    .object({
      tenantId: uuid,
      title: z.string().trim().min(1).max(200),
      body: z.string().max(5000),
      priority: prioritySchema,
      category: z.enum(CATEGORIES),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const id = await createCase(db(), actor, { ...parsed.data, assignToMe: true });
  revalidatePath('/platform/support/cases');
  return { ok: true, data: { id } };
}

export async function updateCaseAction(
  caseId: string,
  patch: {
    status?: string;
    priority?: string;
    category?: string;
    assigneeId?: string | null;
    dueAt?: string | null;
  },
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = z
    .object({
      status: statusSchema.optional(),
      priority: prioritySchema.optional(),
      category: z.enum(CATEGORIES).optional(),
      assigneeId: uuid.nullable().optional(),
      dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .safeParse(patch);
  if (!isUuid(caseId) || !parsed.success) return { ok: false, error: 'invalid' };
  try {
    await updateCase(db(), actor, caseId, {
      ...parsed.data,
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt
            ? new Date(parsed.data.dueAt)
            : null,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/support/cases', 'layout');
  return { ok: true };
}

export async function addCaseEventAction(
  caseId: string,
  input: {
    kind: 'reply' | 'internal_note';
    body: string;
    pinToCustomer?: boolean;
    minutes?: number;
  },
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = z
    .object({
      kind: z.enum(['reply', 'internal_note']),
      body: z.string().trim().min(1).max(5000),
      pinToCustomer: z.boolean().optional(),
      minutes: z.number().int().min(0).max(1440).optional(),
    })
    .safeParse(input);
  if (!isUuid(caseId) || !parsed.success) return { ok: false, error: 'invalid' };
  try {
    await addCaseEvent(db(), actor, caseId, parsed.data);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/platform/support/cases/${caseId}`);
  return { ok: true };
}

export async function followCaseAction(caseId: string, follow: boolean): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(caseId)) return { ok: false, error: 'invalid' };
  await followCase(db(), actor, caseId, follow);
  revalidatePath(`/platform/support/cases/${caseId}`);
  return { ok: true };
}

const timeSchema = z.object({
  caseId: uuid.nullable(),
  tenantId: uuid.nullable(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.number().int().min(1).max(1440),
  kind: z.enum(['phone', 'email', 'clarification', 'meeting', 'other']),
  description: z.string().max(500),
  billable: z.boolean(),
  /** A2/A3: why non-billable time isn't billed. */
  nonBillableReason: z.enum(['agentor_error', 'goodwill']).nullable().optional(),
});

export async function addTimeAction(input: z.input<typeof timeSchema>): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = timeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await addTime(db(), actor, parsed.data);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform', 'layout');
  return { ok: true };
}

export async function startTimerAction(caseId: string | null): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (caseId !== null && !isUuid(caseId)) return { ok: false, error: 'invalid' };
  await startTimer(db(), actor, caseId);
  revalidatePath('/platform', 'layout');
  return { ok: true };
}

/** Stops the timer; MP04 can override the 15-minute round-up, the type and billable (B1). */
export async function stopTimerAction(
  description: string,
  opts?: { minutes?: number; kind?: string; billable?: boolean },
): Promise<ActionResult<{ minutes: number | null }>> {
  const { actor } = await requireStaff();
  const parsed = z
    .object({
      minutes: z.number().int().min(1).max(1440).optional(),
      kind: timeSchema.shape.kind.optional(),
      billable: z.boolean().optional(),
    })
    .safeParse(opts ?? {});
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const o = parsed.data;
  try {
    const minutes = await stopTimer(db(), actor, description.slice(0, 500), {
      ...(o.minutes !== undefined ? { minutes: o.minutes } : {}),
      ...(o.kind !== undefined ? { kind: o.kind } : {}),
      ...(o.billable !== undefined ? { billable: o.billable } : {}),
    });
    revalidatePath('/platform', 'layout');
    return { ok: true, data: { minutes } };
  } catch (e) {
    return fail(e);
  }
}

/** "Ret tid" (MP15): minutes, type, description and billable on one's own entry. */
export async function updateTimeAction(
  id: string,
  input: { minutes: number; kind: string; description: string; billable: boolean },
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = z
    .object({
      minutes: timeSchema.shape.minutes,
      kind: z.enum(['session', 'phone', 'email', 'clarification', 'meeting', 'other']),
      description: timeSchema.shape.description,
      billable: z.boolean(),
    })
    .safeParse(input);
  if (!isUuid(id) || !parsed.success) return { ok: false, error: 'invalid' };
  try {
    await updateTime(db(), actor, id, parsed.data);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform', 'layout');
  return { ok: true };
}

export async function linkSessionAction(sessionId: string, caseId: string): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(sessionId) || !isUuid(caseId)) return { ok: false, error: 'invalid' };
  try {
    await linkSessionTime(db(), actor, sessionId, caseId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/support/time');
  return { ok: true };
}

export async function addCustomerNoteAction(
  tenantId: string,
  body: string,
  pinned: boolean,
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  if (!isUuid(tenantId) || !body.trim()) return { ok: false, error: 'invalid' };
  await addCustomerNote(db(), actor, tenantId, body.slice(0, 2000), pinned);
  revalidatePath(`/platform/customers/${tenantId}`);
  return { ok: true };
}

const resolveSchema = z.object({
  status: z.enum(['resolved', 'closed']),
  closingMessage: z.string().max(5000),
  send: z.boolean(),
  recipients: z.array(uuid).max(20),
  include: z.object({
    messages: z.boolean(),
    status: z.boolean(),
    sessions: z.boolean(),
    time: z.boolean(),
  }),
  askSatisfaction: z.boolean(),
});

/**
 * "Løs og send til kunden" (S8). The e-mail carries the customer's messages and our replies,
 * status changes and a plain summary of support sessions; internal notes never leave.
 */
export async function resolveCaseAction(
  caseId: string,
  input: z.input<typeof resolveSchema>,
): Promise<ActionResult> {
  const { actor } = await requireStaff();
  const parsed = resolveSchema.safeParse(input);
  if (!isUuid(caseId) || !parsed.success) return { ok: false, error: 'invalid' };
  const p = parsed.data;
  const locale = (await getLocale()) as Locale;
  const res = await resolveCase(db(), actor, caseId, {
    status: p.status,
    closingMessage: p.closingMessage,
  });
  if (p.send && p.recipients.length) {
    const people = (await caseRecipients(db(), actor.userId, caseId)).filter((r) =>
      p.recipients.includes(r.userId),
    );
    // E12: one mail per chosen contact; replies go to the case's own address.
    const history = caseHistory(res.events, p, locale);
    const company = (await tenantNames(actor.userId)).get(res.case.tenantId) ?? '';
    const replyTo = await caseReplyAddress(actor.userId, caseId);
    for (const person of people)
      await sendEmail(
        'case-resolved',
        {
          firstName: person.name.split(' ')[0] ?? person.name,
          number: res.case.number,
          title: res.case.title,
          closing: p.closingMessage,
          history: history.length ? history : null,
          minutes: p.include.time ? res.minutes : null,
          askSatisfaction: p.askSatisfaction,
          staffFirstName: actor.name.split(' ')[0] ?? actor.name,
          company,
        },
        { to: person.email, replyTo, entityRef: `case-${res.case.id}`, locale },
      ).catch(() => undefined);
  }
  revalidatePath('/platform/support/cases', 'layout');
  redirect(`/platform/support/cases/${caseId}`);
}

/**
 * The history the supporter chose to send (S8): customer messages and replies, status changes
 * and a plain line per support session. Internal notes are never loaded (resolveCase), and the
 * closing message is the mail's body, not a history entry.
 */
function caseHistory(
  events: CaseEvent[],
  p: z.infer<typeof resolveSchema>,
  locale: Locale,
): CaseHistoryItem[] {
  const out: CaseHistoryItem[] = [];
  const da = locale === 'da';
  for (const e of events) {
    if ((e.kind === 'customer_message' || e.kind === 'reply') && p.include.messages) {
      if (e.meta?.closing) continue;
      out.push({
        who: e.authorName,
        at: e.createdAt,
        body: e.body,
        kind: e.kind === 'reply' ? 'staff' : 'customer',
      });
    } else if (e.kind === 'status' && p.include.status) {
      const resolved = e.meta?.to === 'resolved' || e.meta?.to === 'closed';
      out.push({
        who: 'Status',
        at: e.createdAt,
        body: resolved
          ? da
            ? 'Sagen er markeret som løst.'
            : 'The case has been marked as resolved.'
          : e.body,
        kind: 'status',
      });
    } else if (e.kind === 'session' && p.include.sessions) {
      // Only what we looked at, no technical detail.
      out.push({
        who: 'Agentor support',
        at: e.createdAt,
        body:
          e.body ||
          (da ? 'Vi kiggede på sagen i jeres app.' : 'We looked at the case in your app.'),
        kind: 'agentor',
      });
    }
  }
  return out;
}

/* ---- Staff and settings (P6) ------------------------------------------------------------------ */

export async function upsertStaffAction(input: {
  email: string;
  role: string;
  probationUntil?: string | null;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({
      email: z.email(),
      role: z.enum(['superadmin', 'supporter']),
      probationUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await upsertStaff(db(), actor, {
      email: parsed.data.email,
      role: parsed.data.role,
      probationUntil: parsed.data.probationUntil ? new Date(parsed.data.probationUntil) : null,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/admin/users', 'layout');
  return { ok: true };
}

export async function disableStaffAction(userId: string): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!isUuid(userId)) return { ok: false, error: 'invalid' };
  try {
    await disableStaff(db(), actor, userId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath('/platform/admin/users', 'layout');
  return { ok: true };
}

export async function saveSettingsAction(input: {
  requireCaseAndReason?: boolean;
  warnConcurrentGrants?: number;
  bookkeeperEmail?: string | null;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({
      requireCaseAndReason: z.boolean().optional(),
      warnConcurrentGrants: z.number().int().min(1).max(50).optional(),
      bookkeeperEmail: z.email().max(200).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  await setPlatformSettings(db(), actor, {
    // Case and reason stay required by the database whatever this says (§9.7).
    ...(parsed.data.requireCaseAndReason !== undefined ? { requireCaseAndReason: true } : {}),
    ...(parsed.data.warnConcurrentGrants !== undefined
      ? { warnConcurrentGrants: parsed.data.warnConcurrentGrants }
      : {}),
    ...(parsed.data.bookkeeperEmail !== undefined
      ? { bookkeeperEmail: parsed.data.bookkeeperEmail }
      : {}),
  });
  revalidatePath('/platform', 'layout');
  return { ok: true };
}
