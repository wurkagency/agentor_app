import { DEFAULT_SUPPORT_RATE_ORE, roundUpQuarter } from '@agentor/core';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database, type Transaction } from '../client.js';
import {
  authUsers,
  caseEvents,
  caseFollowers,
  cases,
  customerNotes,
  flows,
  platformAudit,
  platformSettings,
  staff,
  supportSessions,
  timeEntries,
  timers,
  type CaseEventKind,
  type CasePriority,
  type CaseStatus,
  type StaffRole,
  type NonBillableReason,
  type TimeKind,
} from '../schema/index.js';
import { hashInviteToken } from './team.js';

/**
 * Agentor Platform (README decisions 16–17). Staff work outside any customer tenant; the
 * database decides what they may see (migration 0024). Customer data is only reachable in the
 * customer's own app under an approved support grant.
 */

export class PlatformError extends Error {
  constructor(
    readonly code:
      | 'NOT_STAFF'
      | 'NOT_SUPERADMIN'
      | 'NOT_FOUND'
      | 'INVALID'
      | 'NO_ACCESS'
      | 'USER_NOT_FOUND'
      | 'LAST_SUPERADMIN',
  ) {
    super(code);
    this.name = 'PlatformError';
  }
}

export interface StaffActor {
  userId: string;
  name: string;
  role: StaffRole;
}

const asStaff = <T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>) =>
  withoutTenant(db, fn, userId);

async function platformLog(
  tx: Transaction,
  actor: StaffActor,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await tx
    .insert(platformAudit)
    .values({ actorUserId: actor.userId, actorName: actor.name, action, detail });
}

const pgError = (e: unknown, code: string) =>
  e instanceof Error &&
  (e.message.includes(code) || String((e as { cause?: unknown }).cause).includes(code));

/* ---- Staff ------------------------------------------------------------------------------------ */

export async function getStaffRole(db: Database, userId: string): Promise<StaffRole | null> {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<{ role: StaffRole | null }>(sql`select app.staff_role() as role`),
  );
  return res.rows[0]?.role ?? null;
}

export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  probationUntil: Date | null;
  lastActiveAt: Date | null;
  twoFactor: boolean;
  disabled: boolean;
}

export async function listStaff(db: Database, actor: StaffActor): Promise<StaffMember[]> {
  return asStaff(db, actor.userId, async (tx) => {
    const rows = await tx
      .select({
        userId: staff.userId,
        role: staff.role,
        probationUntil: staff.probationUntil,
        disabledAt: staff.disabledAt,
        name: authUsers.name,
        email: authUsers.email,
        twoFactor: authUsers.twoFactorEnabled,
      })
      .from(staff)
      .innerJoin(authUsers, eq(authUsers.id, staff.userId))
      .orderBy(asc(authUsers.name));
    const active = await tx.execute<{ user_id: string; at: Date }>(
      sql`select user_id, max(updated_at) as at from auth.sessions
           where user_id in (select user_id from platform.staff) group by user_id`,
    );
    const seen = new Map(active.rows.map((r) => [r.user_id, r.at ? new Date(r.at) : null]));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role,
      probationUntil: r.probationUntil,
      lastActiveAt: seen.get(r.userId) ?? null,
      twoFactor: Boolean(r.twoFactor),
      disabled: r.disabledAt !== null,
    }));
  }).catch((e) => {
    // auth.sessions isn't readable for every role; fall back without "Sidst aktiv".
    if (pgError(e, 'permission denied')) return listStaffBasic(db, actor);
    throw e;
  });
}

async function listStaffBasic(db: Database, actor: StaffActor): Promise<StaffMember[]> {
  return asStaff(db, actor.userId, async (tx) => {
    const rows = await tx
      .select({
        userId: staff.userId,
        role: staff.role,
        probationUntil: staff.probationUntil,
        disabledAt: staff.disabledAt,
        name: authUsers.name,
        email: authUsers.email,
        twoFactor: authUsers.twoFactorEnabled,
      })
      .from(staff)
      .innerJoin(authUsers, eq(authUsers.id, staff.userId))
      .orderBy(asc(authUsers.name));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role,
      probationUntil: r.probationUntil,
      lastActiveAt: null,
      twoFactor: Boolean(r.twoFactor),
      disabled: r.disabledAt !== null,
    }));
  });
}

/** Superadmin: make an existing Agentor login staff, or change the role. */
export async function upsertStaff(
  db: Database,
  actor: StaffActor,
  input: { email: string; role: StaffRole; probationUntil?: Date | null },
): Promise<string> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  return asStaff(db, actor.userId, async (tx) => {
    const [u] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(sql`lower(${authUsers.email})`, input.email.trim().toLowerCase()));
    if (!u) throw new PlatformError('USER_NOT_FOUND');
    if (u.id === actor.userId && input.role !== 'superadmin')
      await assertNotLastSuperadmin(tx, u.id);
    await tx
      .insert(staff)
      .values({
        userId: u.id,
        role: input.role,
        probationUntil: input.probationUntil ?? null,
        createdByName: actor.name,
      })
      .onConflictDoUpdate({
        target: staff.userId,
        set: { role: input.role, probationUntil: input.probationUntil ?? null, disabledAt: null },
      });
    await platformLog(tx, actor, 'staff.saved', {
      userId: u.id,
      email: input.email,
      role: input.role,
    });
    return u.id;
  });
}

async function assertNotLastSuperadmin(tx: Transaction, userId: string) {
  const res = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from platform.staff where role = 'superadmin' and disabled_at is null and user_id <> ${userId}`,
  );
  if ((res.rows[0]?.n ?? 0) === 0) throw new PlatformError('LAST_SUPERADMIN');
}

export async function disableStaff(db: Database, actor: StaffActor, userId: string) {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  await asStaff(db, actor.userId, async (tx) => {
    await assertNotLastSuperadmin(tx, userId);
    await tx.update(staff).set({ disabledAt: new Date() }).where(eq(staff.userId, userId));
    await platformLog(tx, actor, 'staff.disabled', { userId });
  });
}

/* ---- Settings --------------------------------------------------------------------------------- */

export interface PlatformSettingsValues {
  /** Net øre per hour for billable support time (README decision 18: 640 kr. ex. VAT). */
  hourlyRateOre: number | null;
  maxHours: number;
  requireCaseAndReason: boolean;
  warnConcurrentGrants: number;
  /** Where Finans sends the monthly report (F7 "Send til bogholder"). */
  bookkeeperEmail: string | null;
  /** Agentor's own details on invoices and credit notes (I01/I02); empty prints a placeholder. */
  companyName: string | null;
  companyAddress: string | null;
  companyPostalCity: string | null;
  companyCvr: string | null;
  companyEmail: string | null;
  bankReg: string | null;
  bankAccount: string | null;
  bankIban: string | null;
}

const SETTING_DEFAULTS: PlatformSettingsValues = {
  hourlyRateOre: DEFAULT_SUPPORT_RATE_ORE,
  bookkeeperEmail: null,
  maxHours: 24,
  requireCaseAndReason: true,
  warnConcurrentGrants: 3,
  companyName: null,
  companyAddress: null,
  companyPostalCity: null,
  companyCvr: null,
  companyEmail: null,
  bankReg: null,
  bankAccount: null,
  bankIban: null,
};

export async function getPlatformSettings(
  db: Database,
  userId: string,
): Promise<PlatformSettingsValues> {
  const rows = await asStaff(db, userId, (tx) => tx.select().from(platformSettings));
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function setPlatformSettings(
  db: Database,
  actor: StaffActor,
  values: Partial<PlatformSettingsValues>,
) {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  await asStaff(db, actor.userId, async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in SETTING_DEFAULTS) || value === undefined) continue;
      // A cleared field is stored as JSON null; the column itself is NOT NULL.
      const json = value === null ? sql`'null'::jsonb` : value;
      await tx
        .insert(platformSettings)
        .values({ key, value: json, updatedByName: actor.name })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value: json, updatedByName: actor.name, updatedAt: new Date() },
        });
    }
    await platformLog(tx, actor, 'settings.updated', values);
  });
}

/* ---- Customers (P1, P2) ------------------------------------------------------------------------ */

export type CustomerStatus = 'broken' | 'error' | 'warn' | 'ok' | 'paused' | 'none';
export type GrantState = 'active' | 'pending' | 'expired' | 'ended' | 'denied' | 'revoked';

export interface MyGrant {
  grantId: string;
  tenantId: string;
  tenantName: string;
  caseId: string | null;
  caseRef: string;
  scope: 'view' | 'help';
  state: GrantState;
  approvedByName: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  expiresAt: Date;
  /** Opened directly by Superadmin, without a request. */
  superadmin: boolean;
}

export interface CustomerRow {
  tenantId: string;
  name: string;
  cvr: string | null;
  planId: string | null;
  createdAt: Date;
  flows: number;
  pausedFlows: number;
  brokenConnections: number;
  openFailures: number;
  errorsToday: number;
  lastRunAt: Date | null;
  activeGrants: number;
  requiresApproval: boolean;
  status: CustomerStatus;
  /** This staff member's latest grant there, if any. */
  myGrant: MyGrant | null;
}

export async function myGrants(db: Database, userId: string): Promise<MyGrant[]> {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<Record<string, unknown>>(sql`select * from app.platform_my_grants()`),
  );
  return res.rows
    .map((r) => ({
      grantId: String(r.grant_id),
      tenantId: String(r.tenant_id),
      tenantName: String(r.tenant_name),
      caseId: (r.case_id as string | null) ?? null,
      caseRef: String(r.case_ref),
      scope: r.scope as 'view' | 'help',
      state: r.state as GrantState,
      approvedByName: (r.approved_by_name as string | null) ?? null,
      requestedAt: new Date(r.requested_at as string),
      approvedAt: r.approved_at ? new Date(r.approved_at as string) : null,
      expiresAt: new Date(r.expires_at as string),
      superadmin: Boolean(r.superadmin),
    }))
    .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}

/** A grant on Support › Adgange (S9, MP24): any staff member's, with the case and the action count. */
export interface PlatformGrant {
  grantId: string;
  tenantId: string;
  tenantName: string;
  tenantCvr: string | null;
  staffUserId: string;
  staffName: string;
  caseId: string | null;
  caseRef: string;
  caseNumber: number | null;
  caseTitle: string | null;
  scope: 'view' | 'help';
  state: GrantState;
  approvedByName: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  expiresAt: Date;
  /** When it stopped: ended, revoked, denied or expired. */
  closedAt: Date | null;
  extensionRequestedAt: Date | null;
  /** Support actions in the customer's audit log during the grant. */
  actions: number;
}

/** Every staff member's grants from the last 60 days (app.platform_grants, 0046). */
export async function allGrants(db: Database, userId: string): Promise<PlatformGrant[]> {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<Record<string, unknown>>(sql`select * from app.platform_grants()`),
  );
  const date = (v: unknown) => (v ? new Date(v as string) : null);
  return res.rows
    .map((r) => ({
      grantId: String(r.grant_id),
      tenantId: String(r.tenant_id),
      tenantName: String(r.tenant_name),
      tenantCvr: (r.tenant_cvr as string | null) ?? null,
      staffUserId: String(r.staff_user_id),
      staffName: String(r.staff_name ?? ''),
      caseId: (r.case_id as string | null) ?? null,
      caseRef: String(r.case_ref),
      caseNumber:
        r.case_number === null || r.case_number === undefined ? null : Number(r.case_number),
      caseTitle: (r.case_title as string | null) ?? null,
      scope: r.scope as 'view' | 'help',
      state: r.state as GrantState,
      approvedByName: (r.approved_by_name as string | null) ?? null,
      requestedAt: new Date(r.requested_at as string),
      approvedAt: date(r.approved_at),
      expiresAt: new Date(r.expires_at as string),
      closedAt: date(r.closed_at),
      extensionRequestedAt: date(r.extension_requested_at),
      actions: Number(r.actions ?? 0),
    }))
    .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}

/** Superadmin opens a customer's app directly: no request, no approval, audit log only. */
export async function superadminAccess(
  db: Database,
  actor: StaffActor,
  tenantId: string,
): Promise<string> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ id: string }>(
      sql`select app.platform_superadmin_open(${tenantId}::uuid, ${actor.name}) as id`,
    );
    await platformLog(tx, actor, 'superadmin.opened', { tenantId });
    return res.rows[0]!.id;
  });
}

const statusOf = (r: {
  flows: number;
  pausedFlows: number;
  brokenConnections: number;
  openFailures: number;
}): CustomerStatus =>
  r.brokenConnections > 0
    ? 'broken'
    : r.openFailures > 0
      ? 'error'
      : r.flows === 0
        ? 'none'
        : r.pausedFlows === r.flows
          ? 'paused'
          : 'ok';

export async function listCustomers(db: Database, userId: string): Promise<CustomerRow[]> {
  const [res, grants] = await Promise.all([
    asStaff(db, userId, (tx) =>
      tx.execute<Record<string, unknown>>(sql`select * from app.platform_customers()`),
    ),
    myGrants(db, userId),
  ]);
  return res.rows.map((r) => {
    const base = {
      tenantId: String(r.tenant_id),
      name: String(r.name),
      cvr: (r.cvr as string | null) ?? null,
      planId: (r.plan_id as string | null) ?? null,
      createdAt: new Date(r.created_at as string),
      flows: Number(r.flows),
      pausedFlows: Number(r.paused_flows),
      brokenConnections: Number(r.broken_connections),
      openFailures: Number(r.open_failures),
      errorsToday: Number(r.errors_today),
      lastRunAt: r.last_run_at ? new Date(r.last_run_at as string) : null,
      activeGrants: Number(r.active_grants),
      requiresApproval: Boolean(r.requires_approval),
    };
    return {
      ...base,
      status: statusOf(base),
      myGrant: grants.find((g) => g.tenantId === base.tenantId) ?? null,
    };
  });
}

export interface AccessLogRow {
  at: Date;
  actorName: string;
  actorKind: string;
  action: string;
  after: Record<string, unknown> | null;
}

export async function customerAccessLog(
  db: Database,
  userId: string,
  tenantId: string,
): Promise<AccessLogRow[]> {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<Record<string, unknown>>(sql`select * from app.platform_access_log(${tenantId})`),
  );
  return res.rows.map((r) => ({
    at: new Date(r.at as string),
    actorName: String(r.actor_name ?? ''),
    actorKind: String(r.actor_kind),
    action: String(r.action),
    after: (r.after as Record<string, unknown> | null) ?? null,
  }));
}

/** Owner and admins: only while this staff member holds an active grant there. */
export async function customerContacts(db: Database, userId: string, tenantId: string) {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<{ role: string; name: string; email: string }>(
      sql`select * from app.platform_customer_contacts(${tenantId})`,
    ),
  );
  return res.rows;
}

export async function requestAccess(
  db: Database,
  actor: StaffActor,
  input: {
    tenantId: string;
    caseId: string | null;
    reason: string;
    hours: 1 | 8 | 24;
    scope: 'view' | 'help';
  },
): Promise<{ grantId: string; autoApproved: boolean }> {
  return asStaff(db, actor.userId, async (tx) => {
    let caseRef = 'uden sag';
    if (input.caseId) {
      const [c] = await tx
        .select({ number: cases.number, tenantId: cases.tenantId })
        .from(cases)
        .where(eq(cases.id, input.caseId));
      if (!c || c.tenantId !== input.tenantId) throw new PlatformError('INVALID');
      caseRef = `#${c.number}`;
    }
    const res = await tx.execute<{ grant_id: string; auto_approved: boolean }>(
      sql`select * from app.platform_request_access(${input.tenantId}, ${actor.name}, ${input.caseId},
            ${caseRef}, ${input.reason}, ${input.hours}, ${input.scope})`,
    );
    const row = res.rows[0]!;
    if (input.caseId)
      await tx.insert(caseEvents).values({
        caseId: input.caseId,
        tenantId: input.tenantId,
        kind: 'access',
        authorUserId: actor.userId,
        authorName: actor.name,
        body: input.reason,
        meta: { hours: input.hours, scope: input.scope, grantId: row.grant_id },
      });
    return { grantId: row.grant_id, autoApproved: row.auto_approved };
  });
}

export async function endAccess(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  grantId: string,
) {
  await asStaff(db, actor.userId, (tx) =>
    tx.execute(sql`select app.platform_end_access(${tenantId}, ${grantId}, ${actor.name})`),
  );
}

export async function requestExtension(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  grantId: string,
) {
  await asStaff(db, actor.userId, (tx) =>
    tx.execute(sql`select app.platform_request_extension(${tenantId}, ${grantId}, ${actor.name})`),
  );
}

/** The active grant behind a support view (P4), re-validated on every request. */
export async function activeGrant(
  db: Database,
  userId: string,
  grantId: string,
): Promise<MyGrant | null> {
  const g = (await myGrants(db, userId)).find((x) => x.grantId === grantId);
  return g && g.state === 'active' ? g : null;
}

/* ---- Support sessions (P4, S5) ---------------------------------------------------------------- */

/** Gaps longer than this between two actions don't count as work (README decision 17). */
const IDLE_SECONDS = 10 * 60;

export async function openSession(
  db: Database,
  actor: StaffActor,
  grant: MyGrant,
): Promise<string> {
  return asStaff(db, actor.userId, async (tx) => {
    const [open] = await tx
      .select({ id: supportSessions.id })
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.staffUserId, actor.userId),
          eq(supportSessions.grantId, grant.grantId),
          isNull(supportSessions.endedAt),
        ),
      )
      .limit(1);
    if (open) return open.id;
    const [s] = await tx
      .insert(supportSessions)
      .values({
        grantId: grant.grantId,
        tenantId: grant.tenantId,
        staffUserId: actor.userId,
        caseId: grant.caseId,
        actions: [{ at: new Date().toISOString(), label: 'opened' }],
      })
      .returning({ id: supportSessions.id });
    return s!.id;
  });
}

/** Records one action in the session; active time grows by the gap when it is under 10 min. */
export async function touchSession(db: Database, userId: string, sessionId: string, label: string) {
  await asStaff(db, userId, (tx) =>
    tx.execute(sql`
      update platform.support_sessions
         set active_seconds = active_seconds
               + case when extract(epoch from now() - last_action_at) <= ${IDLE_SECONDS}
                      then extract(epoch from now() - last_action_at)::int else 0 end,
             last_action_at = now(),
             actions = case when jsonb_array_length(actions) >= 200 then actions
                            else actions || jsonb_build_array(jsonb_build_object('at', now(), 'label', ${label}::text)) end
       where id = ${sessionId} and staff_user_id = app.current_user_id() and ended_at is null`),
  );
}

export interface SessionSummary {
  id: string;
  grantId: string;
  tenantId: string;
  caseId: string | null;
  startedAt: Date;
  lastActionAt: Date;
  minutes: number;
  actions: { at: string; label: string }[];
  endedAt: Date | null;
}

export async function getSession(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<SessionSummary | null> {
  const [s] = await asStaff(db, userId, (tx) =>
    tx.select().from(supportSessions).where(eq(supportSessions.id, sessionId)),
  );
  if (!s) return null;
  return {
    id: s.id,
    grantId: s.grantId,
    tenantId: s.tenantId,
    caseId: s.caseId,
    startedAt: s.startedAt,
    lastActionAt: s.lastActionAt,
    minutes: Math.max(1, Math.round(s.activeSeconds / 60)),
    actions: s.actions,
    endedAt: s.endedAt,
  };
}

/** Sessions that ended without being logged ("Session uden sag", S6). */
export async function unconfirmedSessions(db: Database, userId: string) {
  return asStaff(db, userId, (tx) =>
    tx.execute<{
      id: string;
      tenant_id: string;
      started_at: Date;
      last_action_at: Date;
      minutes: number;
    }>(sql`
      select s.id, s.tenant_id, s.started_at, s.last_action_at, greatest(1, round(s.active_seconds / 60.0))::int as minutes
        from platform.support_sessions s
       where s.staff_user_id = app.current_user_id()
         and not exists (select 1 from platform.time_entries t where t.session_id = s.id)
         and (s.ended_at is not null or s.last_action_at < now() - interval '1 hour')
       order by s.started_at desc limit 20`),
  ).then((r) => r.rows);
}

/** "Afslut supportvisning" (S5): end the session and log the confirmed time on the case. */
export async function confirmSession(
  db: Database,
  actor: StaffActor,
  input: {
    sessionId: string;
    minutes: number;
    caseId: string | null;
    billable: boolean;
    summary: string;
  },
) {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)
    throw new PlatformError('INVALID');
  await asStaff(db, actor.userId, async (tx) => {
    const [s] = await tx
      .update(supportSessions)
      .set({ endedAt: sql`coalesce(${supportSessions.endedAt}, now())`, caseId: input.caseId })
      .where(
        and(eq(supportSessions.id, input.sessionId), eq(supportSessions.staffUserId, actor.userId)),
      )
      .returning();
    if (!s) throw new PlatformError('NOT_FOUND');
    await tx.insert(timeEntries).values({
      staffUserId: actor.userId,
      staffName: actor.name,
      caseId: input.caseId,
      tenantId: s.tenantId,
      sessionId: s.id,
      workDate: s.startedAt.toISOString().slice(0, 10),
      minutes: input.minutes,
      kind: 'session',
      source: 'auto',
      description: input.summary.trim().slice(0, 500),
      billable: input.billable,
    });
    if (input.caseId) {
      const [c] = await tx
        .select({ tenantId: cases.tenantId })
        .from(cases)
        .where(eq(cases.id, input.caseId));
      if (!c || c.tenantId !== s.tenantId) throw new PlatformError('INVALID');
      await tx.insert(caseEvents).values({
        caseId: input.caseId,
        tenantId: s.tenantId,
        kind: 'session',
        authorUserId: actor.userId,
        authorName: actor.name,
        body: input.summary.trim(),
        meta: {
          minutes: input.minutes,
          from: s.startedAt.toISOString(),
          to: s.lastActionAt.toISOString(),
          actions: s.actions.length,
        },
      });
      await tx.update(cases).set({ updatedAt: new Date() }).where(eq(cases.id, input.caseId));
    }
  });
}

/* ---- Cases (S1–S3, S8) ------------------------------------------------------------------------ */

export interface CaseRow {
  id: string;
  number: number;
  tenantId: string;
  tenantName: string;
  title: string;
  status: CaseStatus;
  priority: CasePriority;
  category: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  createdByName: string;
  notes: number;
  minutes: number;
  lastCustomerAt: Date | null;
}

export interface CaseFilter {
  status?: CaseStatus[];
  assigneeId?: string | null;
  tenantId?: string;
  q?: string;
  archived?: boolean;
  since?: Date;
}

/** Resolved more than 14 days ago, or closed: the archive (S2). */
const archived = sql`(${cases.status} = 'closed' or (${cases.status} = 'resolved' and ${cases.resolvedAt} < now() - interval '14 days'))`;

export async function listCases(
  db: Database,
  userId: string,
  tenantNames: Map<string, string>,
  filter: CaseFilter = {},
): Promise<CaseRow[]> {
  return asStaff(db, userId, async (tx) => {
    const where = and(
      filter.status?.length ? inArray(cases.status, filter.status) : undefined,
      filter.assigneeId === null
        ? isNull(cases.assigneeId)
        : filter.assigneeId
          ? eq(cases.assigneeId, filter.assigneeId)
          : undefined,
      filter.tenantId ? eq(cases.tenantId, filter.tenantId) : undefined,
      filter.archived === undefined ? undefined : filter.archived ? archived : sql`not ${archived}`,
      filter.since ? gte(cases.createdAt, filter.since) : undefined,
      filter.q
        ? or(
            sql`${cases.title} ilike ${'%' + filter.q + '%'}`,
            sql`${cases.resolution} ilike ${'%' + filter.q + '%'}`,
            sql`exists (select 1 from platform.case_events e where e.case_id = "cases"."id"
                          and e.body ilike ${'%' + filter.q + '%'})`,
            sql`${cases.number}::text = ${filter.q.replace(/^#/, '')}`,
          )
        : undefined,
    );
    const rows = await tx
      .select({
        c: cases,
        notes: sql<number>`(select count(*)::int from platform.case_events e where e.case_id = "cases"."id" and e.kind = 'internal_note')`,
        minutes: sql<number>`(select coalesce(sum(t.minutes), 0)::int from platform.time_entries t where t.case_id = "cases"."id")`,
        lastCustomerAt: sql<Date | null>`(select max(e.created_at) from platform.case_events e where e.case_id = "cases"."id" and e.kind = 'customer_message')`,
      })
      .from(cases)
      .where(where)
      .orderBy(desc(cases.updatedAt))
      .limit(500);
    return rows.map(({ c, notes, minutes, lastCustomerAt }) => ({
      id: c.id,
      number: c.number,
      tenantId: c.tenantId,
      tenantName: tenantNames.get(c.tenantId) ?? '–',
      title: c.title,
      status: c.status,
      priority: c.priority,
      category: c.category,
      assigneeId: c.assigneeId,
      assigneeName: c.assigneeName,
      dueAt: c.dueAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      resolvedAt: c.resolvedAt,
      resolution: c.resolution,
      createdByName: c.createdByName,
      notes: Number(notes),
      minutes: Number(minutes),
      lastCustomerAt: lastCustomerAt ? new Date(lastCustomerAt) : null,
    }));
  });
}

export interface CaseEvent {
  id: string;
  kind: CaseEventKind;
  authorUserId: string | null;
  authorName: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface TimeEntryRow {
  id: string;
  staffUserId: string;
  staffName: string;
  caseId: string | null;
  tenantId: string | null;
  sessionId: string | null;
  workDate: string;
  minutes: number;
  kind: TimeKind;
  source: 'auto' | 'manual' | 'timer';
  description: string;
  billable: boolean;
  invoiced: boolean;
  createdAt: Date;
}

const toTime = (t: typeof timeEntries.$inferSelect): TimeEntryRow => ({
  id: t.id,
  staffUserId: t.staffUserId,
  staffName: t.staffName,
  caseId: t.caseId,
  tenantId: t.tenantId,
  sessionId: t.sessionId,
  workDate: t.workDate,
  minutes: t.minutes,
  kind: t.kind,
  source: t.source,
  description: t.description,
  billable: t.billable,
  invoiced: t.invoiceId !== null,
  createdAt: t.createdAt,
});

export async function getCase(db: Database, userId: string, caseId: string) {
  return asStaff(db, userId, async (tx) => {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
    if (!c) return null;
    // One query at a time: a transaction is one connection.
    const events = await tx
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId))
      .orderBy(asc(caseEvents.createdAt));
    const time = await tx
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.caseId, caseId))
      .orderBy(asc(timeEntries.createdAt));
    const followers = await tx
      .select({ userId: caseFollowers.userId, name: authUsers.name })
      .from(caseFollowers)
      .innerJoin(authUsers, eq(authUsers.id, caseFollowers.userId))
      .where(eq(caseFollowers.caseId, caseId));
    const notes = await tx
      .select()
      .from(customerNotes)
      .where(and(eq(customerNotes.tenantId, c.tenantId), eq(customerNotes.pinned, true)))
      .orderBy(desc(customerNotes.createdAt));
    const previous = await tx
      .select({
        id: cases.id,
        number: cases.number,
        title: cases.title,
        status: cases.status,
        createdAt: cases.createdAt,
      })
      .from(cases)
      .where(and(eq(cases.tenantId, c.tenantId), sql`${cases.id} <> ${caseId}`))
      .orderBy(desc(cases.createdAt))
      .limit(5);
    return {
      case: c,
      events: events as CaseEvent[],
      time: time.map(toTime),
      followers,
      pinnedNotes: notes,
      previous,
    };
  });
}

export async function createCase(
  db: Database,
  actor: StaffActor,
  input: {
    tenantId: string;
    title: string;
    body: string;
    priority: CasePriority;
    category: string;
    assignToMe: boolean;
  },
): Promise<string> {
  return asStaff(db, actor.userId, async (tx) => {
    const [c] = await tx
      .insert(cases)
      .values({
        tenantId: input.tenantId,
        title: input.title.trim().slice(0, 200),
        priority: input.priority,
        category: input.category,
        status: input.assignToMe ? 'in_progress' : 'new',
        assigneeId: input.assignToMe ? actor.userId : null,
        assigneeName: input.assignToMe ? actor.name : null,
        createdByUserId: actor.userId,
        createdByName: actor.name,
        createdVia: 'staff',
      })
      .returning({ id: cases.id });
    if (input.body.trim())
      await tx.insert(caseEvents).values({
        caseId: c!.id,
        tenantId: input.tenantId,
        kind: 'internal_note',
        authorUserId: actor.userId,
        authorName: actor.name,
        body: input.body.trim(),
      });
    return c!.id;
  });
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'Ny',
  in_progress: 'I gang',
  waiting: 'Venter på kunde',
  resolved: 'Løst',
  closed: 'Lukket',
};

export async function updateCase(
  db: Database,
  actor: StaffActor,
  caseId: string,
  patch: {
    status?: CaseStatus | undefined;
    priority?: CasePriority | undefined;
    category?: string | undefined;
    assigneeId?: string | null | undefined;
    dueAt?: Date | null | undefined;
  },
) {
  await asStaff(db, actor.userId, async (tx) => {
    const [before] = await tx.select().from(cases).where(eq(cases.id, caseId));
    if (!before) throw new PlatformError('NOT_FOUND');
    const set: Partial<typeof cases.$inferInsert> = { updatedAt: new Date() };
    if (patch.priority) set.priority = patch.priority;
    if (patch.category) set.category = patch.category;
    if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId) {
        const [u] = await tx
          .select({ name: authUsers.name })
          .from(staff)
          .innerJoin(authUsers, eq(authUsers.id, staff.userId))
          .where(eq(staff.userId, patch.assigneeId));
        if (!u) throw new PlatformError('INVALID');
        set.assigneeId = patch.assigneeId;
        set.assigneeName = u.name;
      } else {
        set.assigneeId = null;
        set.assigneeName = null;
      }
    }
    if (patch.status && patch.status !== before.status) {
      set.status = patch.status;
      set.resolvedAt = patch.status === 'resolved' || patch.status === 'closed' ? new Date() : null;
      await tx.insert(caseEvents).values({
        caseId,
        tenantId: before.tenantId,
        kind: 'status',
        authorUserId: actor.userId,
        authorName: actor.name,
        body: STATUS_LABEL[patch.status],
        meta: { from: before.status, to: patch.status },
      });
    }
    await tx.update(cases).set(set).where(eq(cases.id, caseId));
  });
}

export async function addCaseEvent(
  db: Database,
  actor: StaffActor,
  caseId: string,
  input: {
    kind: 'reply' | 'internal_note';
    body: string;
    pinToCustomer?: boolean | undefined;
    minutes?: number | undefined;
  },
) {
  const body = input.body.trim();
  if (!body) throw new PlatformError('INVALID');
  await asStaff(db, actor.userId, async (tx) => {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
    if (!c) throw new PlatformError('NOT_FOUND');
    await tx.insert(caseEvents).values({
      caseId,
      tenantId: c.tenantId,
      kind: input.kind,
      authorUserId: actor.userId,
      authorName: actor.name,
      body,
    });
    const set: Partial<typeof cases.$inferInsert> = { updatedAt: new Date() };
    // Answering the customer moves a new case along; the customer's turn is next.
    if (input.kind === 'reply' && (c.status === 'new' || c.status === 'in_progress'))
      set.status = 'waiting';
    if (!c.assigneeId) {
      set.assigneeId = actor.userId;
      set.assigneeName = actor.name;
    }
    await tx.update(cases).set(set).where(eq(cases.id, caseId));
    if (input.kind === 'internal_note' && input.pinToCustomer)
      await tx.insert(customerNotes).values({
        tenantId: c.tenantId,
        body,
        pinned: true,
        authorUserId: actor.userId,
        authorName: actor.name,
      });
    if (input.minutes && input.minutes > 0)
      await tx.insert(timeEntries).values({
        staffUserId: actor.userId,
        staffName: actor.name,
        caseId,
        tenantId: c.tenantId,
        workDate: new Date().toISOString().slice(0, 10),
        minutes: Math.min(1440, Math.round(input.minutes)),
        kind: 'clarification',
        source: 'manual',
        description: body.slice(0, 120),
        billable: false,
      });
  });
}

export async function followCase(db: Database, actor: StaffActor, caseId: string, follow: boolean) {
  await asStaff(db, actor.userId, async (tx) => {
    if (follow)
      await tx.insert(caseFollowers).values({ caseId, userId: actor.userId }).onConflictDoNothing();
    else
      await tx
        .delete(caseFollowers)
        .where(and(eq(caseFollowers.caseId, caseId), eq(caseFollowers.userId, actor.userId)));
  });
}

export async function addCustomerNote(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  body: string,
  pinned: boolean,
) {
  if (!body.trim()) throw new PlatformError('INVALID');
  await asStaff(db, actor.userId, (tx) =>
    tx.insert(customerNotes).values({
      tenantId,
      body: body.trim(),
      pinned,
      authorUserId: actor.userId,
      authorName: actor.name,
    }),
  );
}

export async function listCustomerNotes(db: Database, userId: string, tenantId: string) {
  return asStaff(db, userId, (tx) =>
    tx
      .select()
      .from(customerNotes)
      .where(eq(customerNotes.tenantId, tenantId))
      .orderBy(desc(customerNotes.pinned), desc(customerNotes.createdAt)),
  );
}

/**
 * "Løs sag" (S8): marks the case resolved or closed and returns what the customer e-mail
 * contains. Internal notes, access and session details never leave the platform.
 */
export async function resolveCase(
  db: Database,
  actor: StaffActor,
  caseId: string,
  input: { status: 'resolved' | 'closed'; closingMessage: string },
) {
  return asStaff(db, actor.userId, async (tx) => {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
    if (!c) throw new PlatformError('NOT_FOUND');
    const now = new Date();
    if (input.closingMessage.trim())
      await tx.insert(caseEvents).values({
        caseId,
        tenantId: c.tenantId,
        kind: 'reply',
        authorUserId: actor.userId,
        authorName: actor.name,
        body: input.closingMessage.trim(),
        meta: { closing: true },
      });
    await tx.insert(caseEvents).values({
      caseId,
      tenantId: c.tenantId,
      kind: 'status',
      authorUserId: actor.userId,
      authorName: actor.name,
      body: STATUS_LABEL[input.status],
      meta: { from: c.status, to: input.status },
    });
    await tx
      .update(cases)
      .set({
        status: input.status,
        resolvedAt: now,
        updatedAt: now,
        resolution: c.resolution ?? (input.closingMessage.trim().slice(0, 300) || null),
      })
      .where(eq(cases.id, caseId));
    const events = await tx
      .select()
      .from(caseEvents)
      .where(
        and(
          eq(caseEvents.caseId, caseId),
          inArray(caseEvents.kind, ['customer_message', 'reply', 'status', 'session']),
        ),
      )
      .orderBy(asc(caseEvents.createdAt));
    const minutes = await tx.execute<{ m: number }>(
      sql`select coalesce(sum(minutes), 0)::int as m from platform.time_entries where case_id = ${caseId}`,
    );
    return { case: c, events: events as CaseEvent[], minutes: minutes.rows[0]?.m ?? 0 };
  });
}

export interface CaseStats {
  open: number;
  mine: number;
  unassigned: number;
  overdue: number;
  overdueTop: { tenantId: string; minutes: number } | null;
  waiting: number;
  oldestWaitingDays: number | null;
  resolvedThisWeek: number;
  medianResolveMinutes: number | null;
  minutesToday: number;
  teamMinutesToday: number;
  teamSize: number;
}

export async function caseStats(db: Database, userId: string): Promise<CaseStats> {
  return asStaff(db, userId, async (tx) => {
    const r = await tx.execute<Record<string, number | string | null>>(sql`
      select
        count(*) filter (where status in ('new','in_progress','waiting'))::int as open,
        count(*) filter (where status in ('new','in_progress','waiting') and assignee_id = app.current_user_id())::int as mine,
        count(*) filter (where status in ('new','in_progress','waiting') and assignee_id is null)::int as unassigned,
        count(*) filter (where status in ('new','in_progress') and due_at < now())::int as overdue,
        count(*) filter (where status = 'waiting')::int as waiting,
        extract(day from now() - min(updated_at) filter (where status = 'waiting'))::int as oldest_waiting_days,
        count(*) filter (where status in ('resolved','closed') and resolved_at >= date_trunc('week', now()))::int as resolved_week,
        (percentile_cont(0.5) within group (order by extract(epoch from resolved_at - created_at) / 60)
          filter (where status in ('resolved','closed') and resolved_at >= date_trunc('week', now())))::int as median_minutes
      from platform.cases`);
    const t = await tx.execute<Record<string, number | null>>(sql`
      select
        coalesce(sum(minutes) filter (where staff_user_id = app.current_user_id()), 0)::int as mine,
        coalesce(sum(minutes), 0)::int as team
      from platform.time_entries where work_date = current_date`);
    const size = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from platform.staff where disabled_at is null`,
    );
    const top = await tx.execute<{ tenant_id: string; m: number }>(sql`
      select tenant_id, (extract(epoch from now() - due_at) / 60)::int as m from platform.cases
       where status in ('new','in_progress') and due_at < now() order by due_at limit 1`);
    const row = r.rows[0] ?? {};
    return {
      open: Number(row.open ?? 0),
      mine: Number(row.mine ?? 0),
      unassigned: Number(row.unassigned ?? 0),
      overdue: Number(row.overdue ?? 0),
      overdueTop: top.rows[0]
        ? { tenantId: top.rows[0].tenant_id, minutes: Number(top.rows[0].m) }
        : null,
      waiting: Number(row.waiting ?? 0),
      oldestWaitingDays: row.oldest_waiting_days === null ? null : Number(row.oldest_waiting_days),
      resolvedThisWeek: Number(row.resolved_week ?? 0),
      medianResolveMinutes: row.median_minutes === null ? null : Number(row.median_minutes),
      minutesToday: Number(t.rows[0]?.mine ?? 0),
      teamMinutesToday: Number(t.rows[0]?.team ?? 0),
      teamSize: Number(size.rows[0]?.n ?? 0),
    };
  });
}

/* ---- Time (S4, S6) ---------------------------------------------------------------------------- */

type TimeInput = {
  caseId: string | null;
  tenantId: string | null;
  workDate: string;
  minutes: number;
  kind: TimeKind;
  description: string;
  billable: boolean;
  nonBillableReason?: NonBillableReason | null | undefined;
  source?: 'manual' | 'timer';
};

function checkTime(input: TimeInput) {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)
    throw new PlatformError('INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) throw new PlatformError('INVALID');
}

async function insertTime(tx: Transaction, actor: StaffActor, input: TimeInput) {
  let tenantId = input.tenantId;
  if (input.caseId) {
    const [c] = await tx
      .select({ tenantId: cases.tenantId })
      .from(cases)
      .where(eq(cases.id, input.caseId));
    if (!c) throw new PlatformError('NOT_FOUND');
    tenantId = c.tenantId;
    await tx.update(cases).set({ updatedAt: new Date() }).where(eq(cases.id, input.caseId));
  }
  await tx.insert(timeEntries).values({
    staffUserId: actor.userId,
    staffName: actor.name,
    caseId: input.caseId,
    tenantId,
    workDate: input.workDate,
    minutes: input.minutes,
    kind: input.kind,
    source: input.source ?? 'manual',
    description: input.description.trim().slice(0, 500),
    billable: input.billable && tenantId !== null,
    nonBillableReason: input.billable ? null : (input.nonBillableReason ?? null),
  });
}

export async function addTime(db: Database, actor: StaffActor, input: TimeInput) {
  checkTime(input);
  await asStaff(db, actor.userId, (tx) => insertTime(tx, actor, input));
}

/** "Ret tid" (MP15): the person's own entry, until it is invoiced (RLS enforces both too). */
export async function updateTime(
  db: Database,
  actor: StaffActor,
  id: string,
  input: { minutes: number; kind: TimeKind; description: string; billable: boolean },
) {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)
    throw new PlatformError('INVALID');
  const rows = await asStaff(db, actor.userId, (tx) =>
    tx
      .update(timeEntries)
      .set({
        minutes: input.minutes,
        kind: input.kind,
        description: input.description.trim().slice(0, 500),
        // Billable only with a customer, as when the entry was made.
        billable: sql`${input.billable} and ${timeEntries.tenantId} is not null`,
      })
      .where(
        and(
          eq(timeEntries.id, id),
          eq(timeEntries.staffUserId, actor.userId),
          isNull(timeEntries.invoiceId),
        ),
      )
      .returning({ id: timeEntries.id }),
  );
  if (rows.length === 0) throw new PlatformError('NOT_FOUND');
}

export async function linkSessionTime(
  db: Database,
  actor: StaffActor,
  sessionId: string,
  caseId: string,
) {
  await asStaff(db, actor.userId, async (tx) => {
    const [s] = await tx
      .select()
      .from(supportSessions)
      .where(and(eq(supportSessions.id, sessionId), eq(supportSessions.staffUserId, actor.userId)));
    if (!s) throw new PlatformError('NOT_FOUND');
    const [c] = await tx
      .select({ tenantId: cases.tenantId })
      .from(cases)
      .where(eq(cases.id, caseId));
    if (!c || c.tenantId !== s.tenantId) throw new PlatformError('INVALID');
    await tx
      .update(supportSessions)
      .set({ caseId, endedAt: s.endedAt ?? new Date() })
      .where(eq(supportSessions.id, sessionId));
    await tx.insert(timeEntries).values({
      staffUserId: actor.userId,
      staffName: actor.name,
      caseId,
      tenantId: s.tenantId,
      sessionId,
      workDate: s.startedAt.toISOString().slice(0, 10),
      minutes: Math.max(1, Math.round(s.activeSeconds / 60)),
      kind: 'session',
      source: 'auto',
      description: '',
      billable: false,
    });
  });
}

export async function timeBetween(
  db: Database,
  userId: string,
  from: string,
  to: string,
  onlyMine: boolean,
): Promise<TimeEntryRow[]> {
  const rows = await asStaff(db, userId, (tx) =>
    tx
      .select()
      .from(timeEntries)
      .where(
        and(
          gte(timeEntries.workDate, from),
          lt(timeEntries.workDate, to),
          onlyMine ? eq(timeEntries.staffUserId, userId) : undefined,
        ),
      )
      .orderBy(asc(timeEntries.workDate)),
  );
  return rows.map(toTime);
}

export async function getTimer(db: Database, userId: string) {
  const [t] = await asStaff(db, userId, (tx) =>
    tx.select().from(timers).where(eq(timers.staffUserId, userId)),
  );
  return t ?? null;
}

export async function startTimer(db: Database, actor: StaffActor, caseId: string | null) {
  await asStaff(db, actor.userId, (tx) =>
    tx
      .insert(timers)
      .values({ staffUserId: actor.userId, caseId, startedAt: new Date() })
      .onConflictDoUpdate({ target: timers.staffUserId, set: { caseId, startedAt: new Date() } }),
  );
}

/**
 * Stops the timer and logs the time in one transaction. The duration is rounded up to the next
 * 15 minutes unless the person overrides it (PLAN-MOBILE B1: 12 min. 40 s. → 15 min.).
 */
export async function stopTimer(
  db: Database,
  actor: StaffActor,
  description: string,
  opts: { minutes?: number; kind?: TimeKind; billable?: boolean } = {},
) {
  const t = await getTimer(db, actor.userId);
  if (!t) return null;
  const elapsed = Math.max(1, Math.ceil((Date.now() - t.startedAt.getTime()) / 60000));
  const minutes = Math.min(1440, opts.minutes ?? roundUpQuarter(elapsed));
  const input: TimeInput = {
    caseId: t.caseId,
    tenantId: null,
    workDate: new Date().toISOString().slice(0, 10),
    minutes,
    kind: opts.kind ?? 'other',
    description,
    billable: opts.billable ?? false,
    source: 'timer',
  };
  checkTime(input);
  await asStaff(db, actor.userId, async (tx) => {
    await insertTime(tx, actor, input);
    await tx.delete(timers).where(eq(timers.staffUserId, actor.userId));
  });
  return minutes;
}

/* ---- Errors across customers (S7) ------------------------------------------------------------- */

export interface ErrorGroup {
  code: string;
  connectorId: string;
  customers: number;
  records: number;
  firstSeen: Date;
  lastSeen: Date;
  previousCustomers: number;
  trend: 'rising' | 'stable' | 'falling';
  caseNumbers: number[];
  /** Which customers, for the totals only; never shown per group. */
  tenantIds: string[];
}

export async function errorGroups(
  db: Database,
  userId: string,
  days: number,
): Promise<ErrorGroup[]> {
  const to = new Date();
  return errorGroupsBetween(db, userId, new Date(to.getTime() - days * 86_400_000), to);
}

/**
 * Fejl (S7) for a period [from, to): counts per error code in the period, compared with the same
 * length of time before it for the trend and "new" codes.
 */
export async function errorGroupsBetween(
  db: Database,
  userId: string,
  from: Date,
  to: Date,
): Promise<ErrorGroup[]> {
  const before = new Date(from.getTime() - (to.getTime() - from.getTime()));
  return asStaff(db, userId, async (tx) => {
    const res = await tx.execute<{
      error_code: string;
      connector_id: string;
      tenant_id: string;
      records_now: number;
      records_prev: number;
      first_seen: Date;
      last_seen: Date;
    }>(sql`select * from app.platform_error_codes_range(${before}, ${from}, ${to})`);
    const groups = new Map<
      string,
      {
        now: Map<string, number>;
        prev: Set<string>;
        first: Date;
        last: Date;
        connectorId: string;
        code: string;
      }
    >();
    for (const r of res.rows) {
      const key = `${r.error_code}|${r.connector_id}`;
      const g = groups.get(key) ?? {
        now: new Map<string, number>(),
        prev: new Set<string>(),
        first: new Date(r.first_seen),
        last: new Date(r.last_seen),
        connectorId: r.connector_id,
        code: r.error_code,
      };
      const last = new Date(r.last_seen);
      const first = new Date(r.first_seen);
      const now = Number(r.records_now);
      if (now > 0) g.now.set(r.tenant_id, (g.now.get(r.tenant_id) ?? 0) + now);
      if (Number(r.records_prev) > 0) g.prev.add(r.tenant_id);
      if (first < g.first) g.first = first;
      if (last > g.last) g.last = last;
      groups.set(key, g);
    }
    // Cases that mention the code, so a group links to its case ("#2291 + 1").
    const caseRows = await tx.execute<{ number: number; body: string }>(sql`
      select c.number, string_agg(e.body, ' ') as body from platform.cases c
        join platform.case_events e on e.case_id = c.id
       where c.status in ('new','in_progress','waiting') group by c.number`);
    return [...groups.values()]
      .filter((g) => g.now.size > 0)
      .map((g) => {
        const customers = g.now.size;
        const previous = g.prev.size;
        return {
          code: g.code,
          connectorId: g.connectorId,
          customers,
          records: [...g.now.values()].reduce((a, b) => a + b, 0),
          firstSeen: g.first,
          lastSeen: g.last,
          previousCustomers: previous,
          trend: (customers > previous
            ? 'rising'
            : customers < previous
              ? 'falling'
              : 'stable') as ErrorGroup['trend'],
          caseNumbers: caseRows.rows
            .filter((c) => c.body.includes(g.code))
            .map((c) => Number(c.number)),
          tenantIds: [...g.now.keys()],
        };
      })
      .sort((a, b) => b.customers - a.customers || b.records - a.records);
  });
}

/* ---- Customer side: Kontakt support, Mine sager ------------------------------------------------ */

export interface CustomerCtx {
  tenantId: string;
  userId: string;
  name: string;
}

export async function openCustomerCase(
  db: Database,
  ctx: CustomerCtx,
  input: { title: string; body: string; flowId: string | null },
): Promise<{ id: string; number: number }> {
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 5000);
  if (!title || !body) throw new PlatformError('INVALID');
  return withTenant(db, ctx, async (tx) => {
    if (input.flowId) {
      const [f] = await tx.select({ id: flows.id }).from(flows).where(eq(flows.id, input.flowId));
      if (!f) throw new PlatformError('INVALID');
    }
    const [c] = await tx
      .insert(cases)
      .values({
        tenantId: ctx.tenantId,
        title,
        flowId: input.flowId,
        createdByUserId: ctx.userId,
        createdByName: ctx.name,
        createdVia: 'customer',
      })
      .returning({ id: cases.id, number: cases.number });
    await tx.insert(caseEvents).values({
      caseId: c!.id,
      tenantId: ctx.tenantId,
      kind: 'customer_message',
      authorUserId: ctx.userId,
      authorName: ctx.name,
      body,
    });
    return c!;
  });
}

export async function listCustomerCases(db: Database, ctx: CustomerCtx) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: cases.id,
        number: cases.number,
        title: cases.title,
        status: cases.status,
        createdAt: cases.createdAt,
        updatedAt: cases.updatedAt,
        createdByName: cases.createdByName,
      })
      .from(cases)
      .orderBy(desc(cases.updatedAt))
      .limit(100),
  );
}

export async function getCustomerCase(db: Database, ctx: CustomerCtx, caseId: string) {
  return withTenant(db, ctx, async (tx) => {
    const [c] = await tx
      .select({
        id: cases.id,
        number: cases.number,
        title: cases.title,
        status: cases.status,
        createdAt: cases.createdAt,
        resolvedAt: cases.resolvedAt,
      })
      .from(cases)
      .where(eq(cases.id, caseId));
    if (!c) return null;
    // RLS already hides internal notes, access and sessions from the customer.
    const events = await tx
      .select({
        id: caseEvents.id,
        kind: caseEvents.kind,
        authorName: caseEvents.authorName,
        authorUserId: caseEvents.authorUserId,
        body: caseEvents.body,
        createdAt: caseEvents.createdAt,
      })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId))
      .orderBy(asc(caseEvents.createdAt));
    return { case: c, events };
  });
}

export async function customerReply(db: Database, ctx: CustomerCtx, caseId: string, body: string) {
  const text = body.trim().slice(0, 5000);
  if (!text) throw new PlatformError('INVALID');
  await withTenant(db, ctx, async (tx) => {
    const [c] = await tx
      .select({ id: cases.id, status: cases.status })
      .from(cases)
      .where(eq(cases.id, caseId));
    if (!c || c.status === 'closed') throw new PlatformError('NOT_FOUND');
    await tx.insert(caseEvents).values({
      caseId,
      tenantId: ctx.tenantId,
      kind: 'customer_message',
      authorUserId: ctx.userId,
      authorName: ctx.name,
      body: text,
    });
  });
}

export const CASE_STATUS_LABEL = STATUS_LABEL;

/* ---- Platform audit, recipients, grant counts ------------------------------------------------- */

export async function listPlatformAudit(db: Database, actor: StaffActor) {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  return asStaff(db, actor.userId, (tx) =>
    tx.select().from(platformAudit).orderBy(desc(platformAudit.createdAt)).limit(200),
  );
}

export async function caseRecipients(db: Database, userId: string, caseId: string) {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<{ user_id: string; name: string; email: string; role: string }>(
      sql`select * from app.platform_case_recipients(${caseId})`,
    ),
  );
  return res.rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role }));
}

export async function activeGrantsAll(db: Database, userId: string) {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<{ staff_user_id: string; tenant_id: string; expires_at: Date }>(
      sql`select * from app.platform_active_grants()`,
    ),
  );
  return res.rows.map((r) => ({
    staffUserId: r.staff_user_id,
    tenantId: r.tenant_id,
    expiresAt: new Date(r.expires_at),
  }));
}

/** The staff member's support session in progress, if any ("Session i gang", S6). */
export async function myOpenSession(db: Database, userId: string) {
  const [s] = await asStaff(db, userId, (tx) =>
    tx
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.staffUserId, userId),
          isNull(supportSessions.endedAt),
          gte(supportSessions.lastActionAt, new Date(Date.now() - 60 * 60_000)),
        ),
      )
      .orderBy(desc(supportSessions.startedAt))
      .limit(1),
  );
  return s ?? null;
}

/* ---- Create a customer (Superadmin, /platform/customers) ------------------------------------------- */

export interface NewCustomer {
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  billingEmail: string | null;
  ownerEmail: string;
  planId: string;
  interval: 'month' | 'year';
}

/**
 * Creates the company waiting for payment, with its plan and an owner invitation, through
 * app.platform_create_customer. Returns the raw invitation token for the e-mail (only its hash
 * is stored).
 */
export async function createCustomer(
  db: Database,
  actor: StaffActor,
  c: NewCustomer,
): Promise<{ tenantId: string; token: string }> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  const token = randomBytes(32).toString('base64url');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ id: string }>(
      sql`select app.platform_create_customer(${c.name}, ${c.cvr ?? ''}, ${c.addressLine ?? ''}, ${c.postalCode ?? ''}, ${c.city ?? ''}, ${c.billingEmail ?? ''}, ${c.ownerEmail}, ${c.planId}, ${c.interval}, ${hashInviteToken(token)}, ${actor.name}) as id`,
    );
    const tenantId = res.rows[0]!.id;
    await platformLog(tx, actor, 'customer.created', {
      tenantId,
      name: c.name,
      plan: c.planId,
      interval: c.interval,
    });
    return { tenantId, token };
  });
}

/* ---- Customer administration (Superadmin) --------------------------------------------------- */

export type CustomerDetails = Omit<NewCustomer, 'ownerEmail' | 'planId' | 'interval'>;

/** The company's details on P2, through app.platform_customer_update. */
export async function updateCustomer(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  c: CustomerDetails,
): Promise<void> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  await asStaff(db, actor.userId, async (tx) => {
    await tx.execute(
      sql`select app.platform_customer_update(${tenantId}::uuid, ${c.name}, ${c.cvr ?? ''}, ${c.addressLine ?? ''}, ${c.postalCode ?? ''}, ${c.city ?? ''}, ${c.billingEmail ?? ''}, ${actor.name})`,
    );
    await platformLog(tx, actor, 'customer.updated', { tenantId, name: c.name });
  });
}

/** Suspends or reactivates a customer; a reason is required to suspend. */
export async function setCustomerStatus(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<void> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  await asStaff(db, actor.userId, async (tx) => {
    await tx.execute(
      sql`select app.platform_customer_set_status(${tenantId}::uuid, ${status}, ${reason}, ${actor.name})`,
    );
    await platformLog(
      tx,
      actor,
      status === 'suspended' ? 'customer.suspended' : 'customer.reactivated',
      {
        tenantId,
        reason: reason || null,
      },
    );
  });
}

/**
 * A new owner invitation while the company has no owner (the earlier ones are revoked). Returns
 * the address and the raw token for the e-mail.
 */
export async function resendOwnerInvitation(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  email: string,
): Promise<{ email: string; token: string }> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  const token = randomBytes(32).toString('base64url');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ email: string }>(
      sql`select app.platform_customer_resend_owner_invitation(${tenantId}::uuid, ${email}, ${hashInviteToken(token)}, ${actor.name}) as email`,
    );
    const sent = res.rows[0]!.email;
    await platformLog(tx, actor, 'customer.invitation_resent', { tenantId });
    return { email: sent, token };
  });
}

/** Deletes a customer that has never been invoiced; the name must be typed to confirm. */
export async function deleteCustomer(
  db: Database,
  actor: StaffActor,
  tenantId: string,
  confirmName: string,
): Promise<string> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ name: string }>(
      sql`select app.platform_customer_delete(${tenantId}::uuid, ${confirmName}) as name`,
    );
    const name = res.rows[0]!.name;
    await platformLog(tx, actor, 'customer.deleted', { tenantId, name });
    return name;
  });
}

export interface CustomerAdminInfo {
  status: 'active' | 'suspended' | 'deleting';
  signupState: 'pending_plan' | 'pending_payment' | 'active';
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  billingEmail: string | null;
  /** Issued invoices; a customer with any can be suspended but not deleted. */
  invoices: number;
  hasOwner: boolean;
  ownerInvite: { email: string; expiresAt: string; open: boolean } | null;
}

/** What P2's administration shows (Superadmin): status, details and the owner invitation. */
export async function customerAdminInfo(
  db: Database,
  actor: StaffActor,
  tenantId: string,
): Promise<CustomerAdminInfo | null> {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ info: CustomerAdminInfo | null }>(
      sql`select app.platform_customer_admin_info(${tenantId}::uuid) as info`,
    );
    const info = res.rows[0]?.info ?? null;
    return info ? { ...info, invoices: Number(info.invoices) } : null;
  });
}
