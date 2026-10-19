import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { withTenant, type Database, type Transaction } from '../client.js';
import {
  connections,
  flows,
  flowVersions,
  runRecords,
  runs,
  type RecordOutcome,
} from '../schema/index.js';
import { writeAudit, type Actor } from './audit.js';

type Ctx = { tenantId: string; userId: string };

export class FlowError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_PUBLISHED' | 'FORBIDDEN' | 'LOCKED' | 'INVALID') {
    super(code);
    this.name = 'FlowError';
  }
}

/* ---- Reading flows with their health ------------------------------------------------------------ */

export interface RouteStats {
  /** Records on the route in the period (excluding skipped). */
  records: number;
  failed: number;
  openFailures: number;
  lastAt: Date | null;
}

export interface FlowRow {
  id: string;
  name: string;
  template: string | null;
  pausedAt: Date | null;
  pausedByName: string | null;
  routePauses: Record<string, { at: string; by: string }>;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  published: {
    id: string;
    number: number;
    definition: Record<string, unknown>;
    publishedAt: Date | null;
    publishedByName: string | null;
  } | null;
  draft: {
    id: string;
    definition: Record<string, unknown>;
    updatedAt: Date;
    lockedByName: string | null;
  } | null;
  routes: Record<string, RouteStats>;
}

async function routeStats(
  tx: Transaction,
  flowIds: string[],
  since: Date,
): Promise<Map<string, Record<string, RouteStats>>> {
  const out = new Map<string, Record<string, RouteStats>>();
  if (flowIds.length === 0) return out;
  const rows = await tx
    .select({
      flowId: runRecords.flowId,
      routeId: runRecords.routeId,
      records: sql<number>`count(*) filter (where ${runRecords.outcome} <> 'skipped' and ${runRecords.createdAt} >= ${since})::int`,
      failed: sql<number>`count(*) filter (where ${runRecords.outcome} = 'failed' and ${runRecords.createdAt} >= ${since})::int`,
      openFailures: sql<number>`count(distinct ${runRecords.sourceId}) filter (where ${runRecords.outcome} = 'failed' and ${runRecords.resolvedAt} is null)::int`,
      lastAt: sql<Date | null>`max(${runRecords.createdAt})`,
    })
    .from(runRecords)
    .where(inArray(runRecords.flowId, flowIds))
    .groupBy(runRecords.flowId, runRecords.routeId);
  for (const r of rows) {
    const m = out.get(r.flowId) ?? {};
    m[r.routeId] = {
      records: r.records,
      failed: r.failed,
      openFailures: r.openFailures,
      lastAt: r.lastAt ? new Date(r.lastAt) : null,
    };
    out.set(r.flowId, m);
  }
  return out;
}

async function loadFlows(tx: Transaction, since: Date, onlyId?: string): Promise<FlowRow[]> {
  const fl = await tx
    .select()
    .from(flows)
    .where(onlyId ? eq(flows.id, onlyId) : undefined)
    .orderBy(asc(flows.createdAt), asc(flows.name));
  if (fl.length === 0) return [];
  const ids = fl.map((f) => f.id);
  const versions = await tx
    .select()
    .from(flowVersions)
    .where(
      and(inArray(flowVersions.flowId, ids), inArray(flowVersions.state, ['draft', 'published'])),
    )
    .orderBy(desc(flowVersions.number));
  const stats = await routeStats(tx, ids, since);
  return fl.map((f) => {
    const pub = versions.find((v) => v.id === f.publishedVersionId);
    const draft = versions.find((v) => v.flowId === f.id && v.state === 'draft');
    return {
      id: f.id,
      name: f.name,
      template: f.template,
      pausedAt: f.pausedAt,
      pausedByName: f.pausedByName,
      routePauses: f.routePauses,
      lastRunAt: f.lastRunAt,
      nextRunAt: f.nextRunAt,
      createdAt: f.createdAt,
      published: pub
        ? {
            id: pub.id,
            number: pub.number ?? 0,
            definition: pub.definition,
            publishedAt: pub.publishedAt,
            publishedByName: pub.publishedByName,
          }
        : null,
      draft: draft
        ? {
            id: draft.id,
            definition: draft.definition,
            updatedAt: draft.updatedAt,
            lockedByName: draft.lockedByName,
          }
        : null,
      routes: stats.get(f.id) ?? {},
    };
  });
}

export function listFlows(db: Database, ctx: Ctx, since: Date): Promise<FlowRow[]> {
  return withTenant(db, ctx, (tx) => loadFlows(tx, since));
}

export async function getFlow(db: Database, ctx: Ctx, id: string, since: Date) {
  const [row] = await withTenant(db, ctx, (tx) => loadFlows(tx, since, id));
  return row ?? null;
}

export async function listVersions(db: Database, ctx: Ctx, flowId: string) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: flowVersions.id,
        number: flowVersions.number,
        state: flowVersions.state,
        publishedAt: flowVersions.publishedAt,
        publishedByName: flowVersions.publishedByName,
        changeSummary: flowVersions.changeSummary,
        updatedAt: flowVersions.updatedAt,
      })
      .from(flowVersions)
      .where(eq(flowVersions.flowId, flowId))
      .orderBy(sql`${flowVersions.number} desc nulls first`),
  );
}

/** Connection status by id, for status roll-ups and validation. */
export function connectionStates(db: Database, ctx: Ctx) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: connections.id,
        connectorId: connections.connectorId,
        name: connections.name,
        status: connections.status,
        brokenSince: connections.brokenSince,
      })
      .from(connections),
  );
}

/* ---- Overview numbers (D1) ------------------------------------------------------------------------- */

export interface OverviewNumbers {
  revenueOre: number;
  orders: number;
  records: number;
  failed: number;
  /** Failed / (ok + failed), 0..1. */
  errorRate: number;
}

async function numbers(
  tx: Transaction,
  from: Date,
  to: Date,
  flowId?: string,
): Promise<OverviewNumbers> {
  const [r] = await tx
    .select({
      revenue: sql<string>`coalesce(sum(${runRecords.amountOre}) filter (where ${runRecords.entity} = 'order' and ${runRecords.outcome} in ('created', 'updated')), 0)`,
      orders: sql<number>`count(distinct ${runRecords.sourceId}) filter (where ${runRecords.entity} = 'order')::int`,
      records: sql<number>`count(*) filter (where ${runRecords.outcome} in ('created', 'updated'))::int`,
      failed: sql<number>`count(*) filter (where ${runRecords.outcome} = 'failed')::int`,
    })
    .from(runRecords)
    .where(
      and(
        gte(runRecords.createdAt, from),
        lt(runRecords.createdAt, to),
        sql`${runRecords.mode} <> 'test'`,
        flowId ? eq(runRecords.flowId, flowId) : undefined,
      ),
    );
  const records = r?.records ?? 0;
  const failed = r?.failed ?? 0;
  return {
    revenueOre: Number(r?.revenue ?? 0),
    orders: r?.orders ?? 0,
    records,
    failed,
    errorRate: records + failed === 0 ? 0 : failed / (records + failed),
  };
}

export async function overviewNumbers(
  db: Database,
  ctx: Ctx,
  days: number,
  opts: { now?: Date; flowId?: string } = {},
) {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  return withTenant(db, ctx, async (tx) => ({
    current: await numbers(tx, from, now, opts.flowId),
    previous: await numbers(tx, prevFrom, from, opts.flowId),
  }));
}

/* ---- Activity (D1 "Seneste aktivitet", D8 runs, D10 log) ------------------------------------------------ */

export interface RunRouteRow {
  runId: string;
  flowId: string;
  routeId: string;
  at: Date;
  records: number;
  failed: number;
  mode: 'test' | 'draft' | 'live';
}

/** Latest runs per route: one line per (run, route), newest first. */
export async function recentActivity(db: Database, ctx: Ctx, limit = 8, flowId?: string) {
  return withTenant(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        runId: runRecords.runId,
        flowId: runRecords.flowId,
        routeId: runRecords.routeId,
        at: sql<Date>`min(${runRecords.createdAt})`,
        records: sql<number>`count(*) filter (where ${runRecords.outcome} <> 'skipped')::int`,
        failed: sql<number>`count(*) filter (where ${runRecords.outcome} = 'failed')::int`,
        mode: sql<'test' | 'draft' | 'live'>`min(${runRecords.mode})`,
      })
      .from(runRecords)
      .innerJoin(runs, and(eq(runs.id, runRecords.runId), sql`${runs.kind} <> 'test'`))
      .where(flowId ? eq(runRecords.flowId, flowId) : undefined)
      .groupBy(runRecords.runId, runRecords.flowId, runRecords.routeId)
      .orderBy(sql`min(${runRecords.createdAt}) desc`)
      .limit(limit);
    return rows.map((r) => ({ ...r, at: new Date(r.at) })) as RunRouteRow[];
  });
}

export async function listRuns(
  db: Database,
  ctx: Ctx,
  flowId: string,
  since: Date,
  onlyFailed = false,
) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.flowId, flowId),
          gte(runs.startedAt, since),
          sql`${runs.kind} <> 'test'`,
          onlyFailed ? sql`${runs.recordsFailed} > 0` : undefined,
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(100),
  );
}

export async function getRun(db: Database, ctx: Ctx, runId: string) {
  return withTenant(db, ctx, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    if (!run) return null;
    const records = await tx
      .select()
      .from(runRecords)
      .where(eq(runRecords.runId, runId))
      .orderBy(
        sql`case ${runRecords.outcome} when 'failed' then 0 else 1 end`,
        asc(runRecords.createdAt),
      );
    return { run, records };
  });
}

export interface ActivityFilter {
  flowId?: string | undefined;
  entity?: string | undefined;
  outcome?: 'failed' | 'ok' | 'skipped' | 'test' | undefined;
  since: Date;
  /** Order number, name or e-mail fragment. */
  q?: string | undefined;
  before?: Date | undefined;
  limit?: number | undefined;
}

const OK: RecordOutcome[] = ['created', 'updated'];

export async function listActivity(db: Database, ctx: Ctx, f: ActivityFilter) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 1000);
  return withTenant(db, ctx, (tx) =>
    tx
      .select()
      .from(runRecords)
      .where(
        and(
          gte(runRecords.createdAt, f.since),
          f.before ? lt(runRecords.createdAt, f.before) : undefined,
          f.flowId ? eq(runRecords.flowId, f.flowId) : undefined,
          f.entity ? eq(runRecords.entity, f.entity) : undefined,
          f.outcome === 'failed'
            ? eq(runRecords.outcome, 'failed')
            : f.outcome === 'ok'
              ? inArray(runRecords.outcome, OK)
              : f.outcome === 'skipped'
                ? eq(runRecords.outcome, 'skipped')
                : f.outcome === 'test'
                  ? eq(runRecords.mode, 'test')
                  : undefined,
          f.q
            ? sql`${runRecords.label} ilike ${'%' + f.q.replace(/[%_\\]/g, '') + '%'}`
            : undefined,
        ),
      )
      .orderBy(desc(runRecords.createdAt), desc(runRecords.id))
      .limit(limit),
  );
}

/** Open failures for a flow (D7-Flow-Fejl banner, "Gentag 2"). */
export async function openFailures(db: Database, ctx: Ctx, flowId?: string) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select()
      .from(runRecords)
      .where(
        and(
          eq(runRecords.outcome, 'failed'),
          isNull(runRecords.resolvedAt),
          flowId ? eq(runRecords.flowId, flowId) : undefined,
        ),
      )
      .orderBy(desc(runRecords.createdAt)),
  );
}

/**
 * Reconciliation (D10-Afstemning): per day, orders seen in the source vs invoices written to the
 * ERP on order routes. Unresolved failures make up the difference.
 */
export async function reconciliation(
  db: Database,
  ctx: Ctx,
  flowId: string,
  routeIds: string[],
  days: number,
  timeZone = 'Europe/Copenhagen',
  now = new Date(),
) {
  const since = new Date(now.getTime() - days * 86_400_000);
  if (routeIds.length === 0) return [];
  // Route ids are definition keys ([a-z0-9-]); anything else is refused before it reaches SQL.
  if (!routeIds.every((r) => /^[a-z0-9-]{1,40}$/.test(r))) throw new FlowError('INVALID');
  return withTenant(db, ctx, async (tx) => {
    const res = await tx.execute<{
      day: string;
      source_count: number;
      source_amount: string;
      dest_count: number;
      dest_amount: string;
      missing: string[] | null;
    }>(sql`
      with per_record as (
        select source_id, label,
               (min(created_at) at time zone ${timeZone})::date as day,
               max(amount_ore) as amount,
               bool_or(outcome in ('created', 'updated')) as written,
               bool_or(outcome = 'skipped') and not bool_or(outcome in ('created', 'updated', 'failed')) as only_skipped
          from run_records
         where flow_id = ${flowId} and entity = 'order' and route_id in ${sql.raw(
           `(${routeIds.map((r) => `'${r}'`).join(',')})`,
         )}
           and mode <> 'test' and created_at >= ${since}
         group by source_id, label
      )
      select day::text,
             count(*) filter (where not only_skipped)::int as source_count,
             coalesce(sum(amount) filter (where not only_skipped), 0)::text as source_amount,
             count(*) filter (where written)::int as dest_count,
             coalesce(sum(amount) filter (where written), 0)::text as dest_amount,
             array_agg(label order by label) filter (where not written and not only_skipped) as missing
        from per_record group by day order by day desc`);
    return res.rows.map((r) => ({
      day: r.day,
      sourceCount: r.source_count,
      sourceAmount: Number(r.source_amount),
      destCount: r.dest_count,
      destAmount: Number(r.dest_amount),
      missing: r.missing ?? [],
    }));
  });
}

/* ---- Commands -------------------------------------------------------------------------------------- */

export async function setFlowPaused(db: Database, actor: Actor, flowId: string, paused: boolean) {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(flows)
      .set(
        paused
          ? { pausedAt: new Date(), pausedByName: actor.name, updatedAt: new Date() }
          : { pausedAt: null, pausedByName: null, updatedAt: new Date() },
      )
      .where(eq(flows.id, flowId))
      .returning({ id: flows.id });
    if (!res.length) throw new FlowError('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: paused ? 'flow.paused' : 'flow.resumed',
      objectType: 'flow',
      objectId: flowId,
    });
  });
}

export async function setRoutePaused(
  db: Database,
  actor: Actor,
  flowId: string,
  routeId: string,
  paused: boolean,
) {
  if (!/^[a-z0-9-]{1,40}$/.test(routeId)) throw new FlowError('INVALID');
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(flows)
      .set({
        routePauses: paused
          ? sql`${flows.routePauses} || jsonb_build_object(${routeId}::text, jsonb_build_object('at', now(), 'by', ${actor.name}::text))`
          : sql`${flows.routePauses} - ${routeId}::text`,
        updatedAt: new Date(),
      })
      .where(eq(flows.id, flowId))
      .returning({ id: flows.id });
    if (!res.length) throw new FlowError('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: paused ? 'flow.route_paused' : 'flow.route_resumed',
      objectType: 'flow',
      objectId: flowId,
      after: { route: routeId },
    });
  });
}

/**
 * Queues a run of the published version (Kør nu, Gentag) or of a given version (test runs).
 * The worker executes it; the id lets the page follow it.
 */
export async function requestRun(
  db: Database,
  actor: Actor,
  flowId: string,
  kind: 'manual' | 'test' | 'retry',
  versionId?: string,
): Promise<{ runId: string; versionId: string }> {
  return withTenant(db, actor, async (tx) => {
    const [f] = await tx
      .select({ id: flows.id, publishedVersionId: flows.publishedVersionId })
      .from(flows)
      .where(eq(flows.id, flowId));
    if (!f) throw new FlowError('NOT_FOUND');
    const vId = versionId ?? f.publishedVersionId;
    if (!vId) throw new FlowError('NOT_PUBLISHED');
    const [v] = await tx
      .select({ id: flowVersions.id })
      .from(flowVersions)
      .where(and(eq(flowVersions.id, vId), eq(flowVersions.flowId, flowId)));
    if (!v) throw new FlowError('NOT_FOUND');
    const [r] = await tx
      .insert(runs)
      .values({
        tenantId: actor.tenantId,
        flowId,
        versionId: vId,
        kind,
        status: 'queued',
        requestedByName: actor.name,
      })
      .returning({ id: runs.id });
    if (kind !== 'test')
      await writeAudit(tx, actor, {
        action: kind === 'retry' ? 'flow.retried' : 'flow.run_requested',
        objectType: 'flow',
        objectId: flowId,
      });
    return { runId: r!.id, versionId: vId };
  });
}

/** For the command palette: order numbers and names among recent records (D1-Søg). */
export async function searchRecords(db: Database, ctx: Ctx, q: string, limit = 5) {
  const term = q.replace(/[%_\\]/g, '').trim();
  if (term.length < 2) return [];
  return withTenant(db, ctx, (tx) =>
    tx
      .selectDistinctOn([runRecords.label], {
        label: runRecords.label,
        flowId: runRecords.flowId,
        outcome: runRecords.outcome,
        createdAt: runRecords.createdAt,
        customer: sql<string | null>`${runRecords.preview} ->> 'customer'`,
      })
      .from(runRecords)
      .where(
        or(
          sql`${runRecords.label} ilike ${'%' + term + '%'}`,
          sql`${runRecords.preview} ->> 'customer' ilike ${'%' + term + '%'}`,
        ),
      )
      .orderBy(runRecords.label, desc(runRecords.createdAt))
      .limit(limit),
  );
}

/** Daily figures for the Overblik sparklines (D1), oldest first, in the tenant's time zone. */
export async function dailyNumbers(
  db: Database,
  ctx: Ctx,
  days: number,
  timeZone = 'Europe/Copenhagen',
  now = new Date(),
) {
  const since = new Date(now.getTime() - days * 86_400_000);
  return withTenant(db, ctx, async (tx) => {
    const res = await tx.execute<{
      day: string;
      revenue: string;
      orders: number;
      records: number;
      failed: number;
    }>(sql`
      select (created_at at time zone ${timeZone})::date::text as day,
             coalesce(sum(amount_ore) filter (where entity = 'order' and outcome in ('created', 'updated')), 0)::text as revenue,
             count(distinct source_id) filter (where entity = 'order')::int as orders,
             count(*) filter (where outcome in ('created', 'updated'))::int as records,
             count(*) filter (where outcome = 'failed')::int as failed
        from run_records
       where created_at >= ${since} and mode <> 'test'
       group by 1 order by 1`);
    return res.rows.map((r) => ({
      day: r.day,
      revenueOre: Number(r.revenue),
      orders: r.orders,
      records: r.records,
      errorRate: r.records + r.failed ? r.failed / (r.records + r.failed) : 0,
    }));
  });
}
