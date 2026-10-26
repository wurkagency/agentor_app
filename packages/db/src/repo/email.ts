import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { withTenant, withoutTenant, type Database } from '../client.js';
import {
  cases,
  connections,
  flows,
  flowVersions,
  notificationPrefs,
  notifications,
  notificationSettings,
  runRecords,
  runs,
  subscriptions,
  tenants,
  usageCounters,
  type NotificationEvent,
} from '../schema/index.js';
import { loadPlansTx } from './billing.js';
import { DEFAULT_PREFS } from './settings.js';

/**
 * E-mail plumbing (PLAN-EMAILS-PDF §5): the worker's notification e-mail queue (E19–E22), the
 * facts each e-mail shows, one-click unsubscribe, and replies to a case by e-mail (E12).
 */

/* ---- Queue ------------------------------------------------------------------------------------- */

export type EmailEvent = 'connection_broken' | 'systematic_error' | 'quota' | 'weekly_summary';

export interface DueEmail {
  id: number;
  tenantId: string;
  userId: string;
  event: EmailEvent;
  dedupeKey: string;
  notificationId: string | null;
  attempts: number;
  createdAt: Date;
}

export async function dueEmails(db: Database, now = new Date()): Promise<DueEmail[]> {
  const res = await db.execute<{
    id: string;
    tenant_id: string;
    user_id: string;
    event: EmailEvent;
    dedupe_key: string;
    notification_id: string | null;
    attempts: number;
    created_at: string | Date;
  }>(sql`select * from app.due_emails(${now.toISOString()}::timestamptz)`);
  return res.rows.map((r) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    userId: r.user_id,
    event: r.event,
    dedupeKey: r.dedupe_key,
    notificationId: r.notification_id,
    attempts: Number(r.attempts),
    createdAt: new Date(r.created_at),
  }));
}

export async function emailSent(db: Database, id: number, messageId: string) {
  await db.execute(sql`select app.email_sent(${id}::bigint, ${messageId})`);
}
export async function emailSkip(db: Database, id: number) {
  await db.execute(sql`select app.email_skip(${id}::bigint)`);
}
export async function emailDefer(db: Database, id: number, until: Date) {
  await db.execute(sql`select app.email_defer(${id}::bigint, ${until.toISOString()}::timestamptz)`);
}
export async function emailFailed(db: Database, id: number) {
  await db.execute(sql`select app.email_failed(${id}::bigint)`);
}

/** Queues one e-mail in the tenant's context; false when the key was queued before. */
export async function queueEmail(
  db: Database,
  tenantId: string,
  e: { userId: string; event: EmailEvent; key: string; notBefore?: Date | null },
): Promise<boolean> {
  return withTenant(db, { tenantId }, async (tx) => {
    const res = await tx.execute<{ ok: boolean }>(
      sql`select app.queue_email(${tenantId}::uuid, ${e.userId}::uuid, ${e.event}, ${e.key}, null, ${e.notBefore?.toISOString() ?? null}::timestamptz) as ok`,
    );
    return Boolean(res.rows[0]?.ok);
  });
}

/* ---- What an e-mail needs ------------------------------------------------------------------------ */

export interface EmailRecipient {
  email: string;
  name: string;
  locale: 'da' | 'en';
  tenantName: string;
  /** The recipient still has e-mail on for this event (checked at send time). */
  emailOn: boolean;
  quiet: { enabled: boolean; start: string; end: string };
  notification: {
    params: Record<string, string | number>;
    href: string | null;
    flowId: string | null;
    connectionId: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  } | null;
}

/** The recipient, still a member of the company, with their choices; null when they left. */
export async function emailRecipient(
  db: Database,
  row: Pick<DueEmail, 'tenantId' | 'userId' | 'event' | 'notificationId'>,
): Promise<EmailRecipient | null> {
  return withTenant(db, { tenantId: row.tenantId }, async (tx) => {
    // The worker can't read auth.users; app.email_recipient returns a member's address only.
    const res = await tx.execute<{ email: string; name: string; locale: string }>(
      sql`select * from app.email_recipient(${row.tenantId}::uuid, ${row.userId}::uuid)`,
    );
    const m = res.rows[0];
    if (!m) return null;
    const [t] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
    const [pref] = await tx
      .select({ email: notificationPrefs.email })
      .from(notificationPrefs)
      .where(and(eq(notificationPrefs.userId, row.userId), eq(notificationPrefs.event, row.event)));
    const [settings] = await tx
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, row.userId));
    const [n] = row.notificationId
      ? await tx
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.id, row.notificationId), eq(notifications.userId, row.userId)),
          )
      : [];
    return {
      email: m.email,
      name: m.name,
      locale: m.locale === 'en' ? 'en' : 'da',
      tenantName: t?.name ?? '',
      emailOn: pref ? pref.email : DEFAULT_PREFS[row.event as NotificationEvent].email,
      quiet: settings
        ? { enabled: settings.quietEnabled, start: settings.quietStart, end: settings.quietEnd }
        : { enabled: true, start: '22:00', end: '07:00' },
      notification: n
        ? {
            params: n.params,
            href: n.href,
            flowId: n.flowId,
            connectionId: n.connectionId,
            createdAt: n.createdAt,
            resolvedAt: n.resolvedAt,
          }
        : null,
    };
  });
}

interface Definition {
  nodes?: { id: string; role?: string; connectionId?: string }[];
  routes?: { id: string; from?: string; to?: string; entity?: string; paused?: boolean }[];
}

/** Routes in a flow that read from or write to the connection. */
function routesTouching(def: Definition, connectionId: string): number {
  const nodes = new Map((def.nodes ?? []).map((n) => [n.id, n.connectionId]));
  const source = (def.nodes ?? []).find((n) => n.role === 'source');
  return (def.routes ?? []).filter(
    (r) =>
      (r.to && nodes.get(r.to) === connectionId) ||
      (r.from ? nodes.get(r.from) : source?.connectionId) === connectionId,
  ).length;
}

/** E19: the broken connection, the flows that use it (as the recipient sees them) and the queue. */
export async function connectionEmailFacts(
  db: Database,
  tenantId: string,
  userId: string,
  connectionId: string,
) {
  return withTenant(db, { tenantId, userId }, async (tx) => {
    const [c] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    if (!c) return null;
    const rows = await tx
      .select({ id: flows.id, name: flows.name, definition: flowVersions.definition })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(isNotNull(flows.publishedVersionId));
    const used = rows
      .map((f) => ({
        id: f.id,
        name: f.name,
        routes: routesTouching(f.definition as Definition, connectionId),
      }))
      .filter((f) => f.routes > 0)
      .sort((a, b) => b.routes - a.routes);
    const waiting = used.length
      ? await tx
          .select({ count: sql<number>`count(distinct ${runRecords.sourceId})::int` })
          .from(runRecords)
          .where(
            and(
              inArray(
                runRecords.flowId,
                used.map((f) => f.id),
              ),
              eq(runRecords.outcome, 'waiting'),
              isNull(runRecords.resolvedAt),
            ),
          )
      : [];
    return {
      connectorId: c.connectorId,
      name: c.name,
      status: c.status,
      statusReason: c.statusReason,
      brokenSince: c.brokenSince,
      tokenExpiresAt: c.tokenExpiresAt,
      flows: used,
      waiting: Number(waiting[0]?.count ?? 0),
    };
  });
}

/* ---- E20: the same error on one route within 15 minutes ------------------------------------------ */

export interface SystematicFailure {
  routeId: string;
  entity: string;
  errorCode: string;
  errorParams: Record<string, string> | null;
  label: string;
  count: number;
  lastAt: Date;
}

/**
 * Live/draft records on a flow that failed with the same error on the same route in the last 15
 * minutes, when there are at least the company's threshold of them (tenants.alert_consecutive_
 * failures, default 3). Test runs don't count.
 */
export async function systematicFailures(
  db: Database,
  tenantId: string,
  flowId: string,
  now = new Date(),
): Promise<SystematicFailure[]> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [t] = await tx
      .select({ threshold: tenants.alertConsecutiveFailures })
      .from(tenants)
      .limit(1);
    const threshold = Math.max(1, t?.threshold ?? 3);
    const since = new Date(now.getTime() - 15 * 60_000);
    const res = await tx.execute<{
      route_id: string;
      entity: string;
      error_code: string;
      error_params: Record<string, string> | null;
      label: string;
      n: number;
      last_at: string | Date;
    }>(sql`
      select r.route_id, r.entity, r.error_code,
             (array_agg(r.error_params order by r.created_at desc))[1] as error_params,
             (array_agg(r.label order by r.created_at desc))[1] as label,
             count(distinct r.source_id)::int as n, max(r.created_at) as last_at
        from run_records r
       where r.flow_id = ${flowId} and r.outcome = 'failed' and r.mode <> 'test'
         and r.error_code is not null and r.resolved_at is null
         and r.created_at >= ${since.toISOString()}::timestamptz
       group by r.route_id, r.entity, r.error_code
      having count(distinct r.source_id) >= ${threshold}
       order by n desc`);
    return res.rows.map((r) => ({
      routeId: r.route_id,
      entity: r.entity,
      errorCode: r.error_code,
      errorParams: r.error_params,
      label: r.label,
      count: Number(r.n),
      lastAt: new Date(r.last_at),
    }));
  });
}

/** E20 needs the destination system's connector for the route, to name it in "why". */
export async function routeDestination(
  db: Database,
  tenantId: string,
  flowId: string,
  routeId: string,
): Promise<{ connectorId: string; flowName: string } | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [f] = await tx
      .select({ name: flows.name, definition: flowVersions.definition })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(eq(flows.id, flowId));
    if (!f) return null;
    const def = f.definition as Definition;
    const route = (def.routes ?? []).find((r) => r.id === routeId);
    const node = (def.nodes ?? []).find((n) => n.id === route?.to);
    if (!node?.connectionId) return { connectorId: '', flowName: f.name };
    const [c] = await tx
      .select({ connectorId: connections.connectorId })
      .from(connections)
      .where(eq(connections.id, node.connectionId));
    return { connectorId: c?.connectorId ?? '', flowName: f.name };
  });
}

/* ---- E21 -------------------------------------------------------------------------------------- */

/** The usage the quota e-mail shows: this period's counter and the plan's limit. */
export async function quotaFacts(db: Database, tenantId: string, period: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const [u] = await tx
      .select({ used: usageCounters.transactions })
      .from(usageCounters)
      .where(eq(usageCounters.period, period));
    const [sub] = await tx.select({ planId: subscriptions.planId }).from(subscriptions).limit(1);
    const plan = sub ? (await loadPlansTx(tx)).find((p) => p.id === sub.planId) : undefined;
    return {
      used: u?.used ?? 0,
      limit: plan?.entitlements.transactionsPerMonth ?? null,
      plan: plan?.name ?? '',
    };
  });
}

/* ---- E22: the weekly summary ---------------------------------------------------------------------- */

/** Everyone with the weekly e-mail on (opt-in, default off), across companies. */
export async function weeklyRecipients(
  db: Database,
): Promise<{ tenantId: string; userId: string }[]> {
  const res = await db.execute<{ tenant_id: string; user_id: string }>(
    sql`select * from app.weekly_summary_recipients()`,
  );
  return res.rows.map((r) => ({ tenantId: r.tenant_id, userId: r.user_id }));
}

export interface WeeklyStats {
  records: number;
  orders: number;
  errors: number;
  runs: number;
  okRuns: number;
  flows: { name: string; records: number; errors: number; brokenSince: Date | null }[];
}

/** The week's numbers as the recipient sees them (their flows only, RLS). */
export async function weeklyStats(
  db: Database,
  tenantId: string,
  userId: string,
  from: Date,
  to: Date,
): Promise<WeeklyStats> {
  return withTenant(db, { tenantId, userId }, async (tx) => {
    const recs = await tx
      .select({
        flowId: runRecords.flowId,
        records: sql<number>`count(*) filter (where ${runRecords.outcome} in ('created', 'updated'))::int`,
        orders: sql<number>`count(*) filter (where ${runRecords.outcome} in ('created', 'updated') and ${runRecords.entity} = 'order')::int`,
        errors: sql<number>`count(*) filter (where ${runRecords.outcome} = 'failed')::int`,
      })
      .from(runRecords)
      .where(
        and(
          gte(runRecords.createdAt, from),
          lt(runRecords.createdAt, to),
          sql`${runRecords.mode} <> 'test'`,
        ),
      )
      .groupBy(runRecords.flowId);
    const [r] = await tx
      .select({
        runs: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${runs.recordsFailed} = 0)::int`,
      })
      .from(runs)
      .where(
        and(
          gte(runs.startedAt, from),
          lt(runs.startedAt, to),
          isNotNull(runs.finishedAt),
          sql`${runs.kind} <> 'test'`,
        ),
      );
    const flowRows = await tx
      .select({ id: flows.id, name: flows.name, definition: flowVersions.definition })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(isNotNull(flows.publishedVersionId));
    const broken = await tx
      .select({ id: connections.id, since: connections.brokenSince })
      .from(connections)
      .where(eq(connections.status, 'broken'));
    const brokenById = new Map(broken.map((b) => [b.id, b.since]));
    const by = new Map(recs.map((x) => [x.flowId, x]));
    const list = flowRows.map((f) => {
      const def = f.definition as Definition;
      const sinces = (def.nodes ?? [])
        .map((n) => (n.connectionId ? brokenById.get(n.connectionId) : undefined))
        .filter((d): d is Date => d instanceof Date);
      const s = by.get(f.id);
      return {
        name: f.name,
        records: Number(s?.records ?? 0),
        errors: Number(s?.errors ?? 0),
        brokenSince: sinces.length ? sinces.sort((a, b) => a.getTime() - b.getTime())[0]! : null,
      };
    });
    const sum = (k: 'records' | 'orders' | 'errors') =>
      recs.reduce((a, x) => a + Number(x[k] ?? 0), 0);
    return {
      records: sum('records'),
      orders: sum('orders'),
      errors: sum('errors'),
      runs: Number(r?.runs ?? 0),
      okRuns: Number(r?.ok ?? 0),
      flows: list,
    };
  });
}

/* ---- Unsubscribe (E22) ------------------------------------------------------------------------- */

export async function unsubscribeToken(
  db: Database,
  tenantId: string,
  userId: string,
  fresh: string,
): Promise<string> {
  return withTenant(db, { tenantId }, async (tx) => {
    const res = await tx.execute<{ token: string }>(
      sql`select app.unsubscribe_token(${tenantId}::uuid, ${userId}::uuid, 'weekly_summary', ${fresh}) as token`,
    );
    return res.rows[0]!.token;
  });
}

export async function unsubscribeInfo(db: Database, token: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const res = await withoutTenant(db, (tx) =>
    tx.execute<{ tenant_name: string; event: string; active: boolean }>(
      sql`select * from app.unsubscribe_info(${token})`,
    ),
  );
  const r = res.rows[0];
  return r ? { tenantName: r.tenant_name, event: r.event, active: Boolean(r.active) } : null;
}

export async function unsubscribeApply(db: Database, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return false;
  const res = await withoutTenant(db, (tx) =>
    tx.execute<{ ok: boolean }>(sql`select app.unsubscribe_apply(${token}) as ok`),
  );
  return Boolean(res.rows[0]?.ok);
}

/* ---- Case replies (E12) ------------------------------------------------------------------------ */

/** The case's reply token, created with the caller's random value the first time (staff only). */
export async function ensureCaseReplyToken(
  db: Database,
  staffUserId: string,
  caseId: string,
  fresh: string,
): Promise<string> {
  return withoutTenant(
    db,
    async (tx) => {
      const [row] = await tx
        .update(cases)
        .set({ replyToken: sql`coalesce(${cases.replyToken}, ${fresh})` })
        .where(eq(cases.id, caseId))
        .returning({ token: cases.replyToken });
      if (!row?.token) throw new Error('CASE_NOT_FOUND');
      return row.token;
    },
    staffUserId,
  );
}

export type CaseReplyResult =
  'reopened' | 'added' | 'satisfaction' | 'archived' | 'not_member' | 'unknown' | 'empty';

/** An inbound reply to sag+<token>@…: added to the case as the member's own message. */
export async function caseReplyByEmail(
  db: Database,
  token: string,
  from: string,
  body: string,
): Promise<CaseReplyResult> {
  const res = await withoutTenant(db, (tx) =>
    tx.execute<{ r: CaseReplyResult }>(
      sql`select app.case_reply_by_email(${token}, ${from}, ${body}) as r`,
    ),
  );
  return res.rows[0]?.r ?? 'unknown';
}

/** The newest notification for a connection or flow, for tests and the e-mail facts. */
export async function latestNotification(db: Database, tenantId: string, userId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const [n] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    return n ?? null;
  });
}
