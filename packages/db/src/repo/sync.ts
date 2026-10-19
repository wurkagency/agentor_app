import { nextRecordRetry } from '@agentor/core';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, min, sql } from 'drizzle-orm';
import { withTenant, type Database } from '../client.js';
import {
  entityLinks,
  flows,
  flowVersions,
  recordLinks,
  runRecords,
  runs,
  syncCursors,
  syncItems,
  syncPayloads,
  type RecordOutcome,
} from '../schema/index.js';
import { addUsageTx, type ClaimedRun, type RecordInsert } from './engine.js';

/**
 * Sync engine state (produktspecifikation §4.1): polling cursors, the idempotency key, fetched
 * payloads between the fetch job and the route jobs, Agentor's own writes per destination, and
 * per-record retries. Worker only; every call re-enters the tenant from the job.
 */

/* ---- Cursors -------------------------------------------------------------------------------------- */

export async function getCursor(
  db: Database,
  tenantId: string,
  key: { flowId: string; connectionId: string; entity: string },
): Promise<Date | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [c] = await tx
      .select({ cursor: syncCursors.cursor })
      .from(syncCursors)
      .where(
        and(
          eq(syncCursors.flowId, key.flowId),
          eq(syncCursors.connectionId, key.connectionId),
          eq(syncCursors.entity, key.entity),
        ),
      );
    return c?.cursor ?? null;
  });
}

/** Moves the cursor forward only; a slow run never moves it back. */
export async function advanceCursor(
  db: Database,
  tenantId: string,
  key: { flowId: string; connectionId: string; entity: string },
  cursor: Date,
): Promise<void> {
  await withTenant(db, { tenantId }, (tx) =>
    tx
      .insert(syncCursors)
      .values({ tenantId, ...key, cursor })
      .onConflictDoUpdate({
        target: [
          syncCursors.tenantId,
          syncCursors.flowId,
          syncCursors.connectionId,
          syncCursors.entity,
        ],
        set: {
          cursor: sql`greatest(${syncCursors.cursor}, excluded.cursor)`,
          updatedAt: new Date(),
        },
      }),
  );
}

/* ---- Idempotency ---------------------------------------------------------------------------------- */

/**
 * Registers record versions for a run and returns the source ids that are new: a version the
 * flow has seen before (an overlapping poll, a repeated webhook) is dropped.
 */
export async function claimVersions(
  db: Database,
  tenantId: string,
  key: { flowId: string; connectionId: string; entity: string; runId: string },
  items: { sourceId: string; version: string }[],
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .insert(syncItems)
      .values(
        items.map((i) => ({
          tenantId,
          flowId: key.flowId,
          connectionId: key.connectionId,
          entity: key.entity,
          sourceId: i.sourceId,
          sourceVersion: i.version,
          runId: key.runId,
        })),
      )
      .onConflictDoNothing()
      .returning({ sourceId: syncItems.sourceId });
    return new Set(rows.map((r) => r.sourceId));
  });
}

/* ---- Payloads --------------------------------------------------------------------------------------- */

export async function storePayloads(
  db: Database,
  tenantId: string,
  runId: string,
  entity: string,
  records: { sourceId: string; version: string; payload: unknown }[],
): Promise<void> {
  if (records.length === 0) return;
  await withTenant(db, { tenantId }, (tx) =>
    tx
      .insert(syncPayloads)
      .values(
        records.map((r) => ({
          tenantId,
          runId,
          entity,
          sourceId: r.sourceId,
          sourceVersion: r.version,
          payload: r.payload,
        })),
      )
      .onConflictDoNothing(),
  );
}

export async function loadPayloads(
  db: Database,
  tenantId: string,
  runId: string,
  entity: string,
): Promise<{ sourceId: string; version: string; payload: unknown }[]> {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select({
        sourceId: syncPayloads.sourceId,
        version: syncPayloads.sourceVersion,
        payload: syncPayloads.payload,
      })
      .from(syncPayloads)
      .where(and(eq(syncPayloads.runId, runId), eq(syncPayloads.entity, entity)));
    return rows;
  });
}

export async function deletePayloads(db: Database, tenantId: string, runId: string) {
  await withTenant(db, { tenantId }, (tx) =>
    tx.delete(syncPayloads).where(eq(syncPayloads.runId, runId)),
  );
}

/* ---- Agentor's own writes: dependencies and echo suppression ------------------------------------- */

export async function findLinks(
  db: Database,
  tenantId: string,
  key: { connectionId: string; entity: string; sourceConnectionId: string },
  sourceIds: string[],
): Promise<Map<string, string>> {
  if (sourceIds.length === 0) return new Map();
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select({ sourceId: entityLinks.sourceId, destinationId: entityLinks.destinationId })
      .from(entityLinks)
      .where(
        and(
          eq(entityLinks.connectionId, key.connectionId),
          eq(entityLinks.entity, key.entity),
          eq(entityLinks.sourceConnectionId, key.sourceConnectionId),
          inArray(entityLinks.sourceId, sourceIds),
        ),
      );
    return new Map(rows.map((r) => [r.sourceId, r.destinationId]));
  });
}

export async function saveLink(
  db: Database,
  tenantId: string,
  link: {
    connectionId: string;
    entity: string;
    sourceConnectionId: string;
    sourceId: string;
    destinationId: string;
  },
): Promise<void> {
  await withTenant(db, { tenantId }, (tx) =>
    tx
      .insert(entityLinks)
      .values({ tenantId, ...link })
      .onConflictDoUpdate({
        target: [
          entityLinks.tenantId,
          entityLinks.connectionId,
          entityLinks.entity,
          entityLinks.sourceConnectionId,
          entityLinks.sourceId,
        ],
        set: { destinationId: link.destinationId, writtenAt: new Date() },
      }),
  );
}

/**
 * Echo suppression: source ids on a connection that are objects Agentor itself wrote there
 * recently (within `windowMs` of their change). A change we made must not sync back.
 */
export async function echoes(
  db: Database,
  tenantId: string,
  connectionId: string,
  changes: { sourceId: string; changedAt: string | null }[],
  windowMs = 5 * 60_000,
): Promise<Set<string>> {
  if (changes.length === 0) return new Set();
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select({ destinationId: entityLinks.destinationId, writtenAt: entityLinks.writtenAt })
      .from(entityLinks)
      .where(
        and(
          eq(entityLinks.connectionId, connectionId),
          inArray(
            entityLinks.destinationId,
            changes.map((c) => c.sourceId),
          ),
        ),
      );
    const written = new Map(rows.map((r) => [r.destinationId, r.writtenAt.getTime()]));
    const out = new Set<string>();
    for (const c of changes) {
      const w = written.get(c.sourceId);
      if (w === undefined) continue;
      const at = c.changedAt ? Date.parse(c.changedAt) : Date.now();
      if (Math.abs(at - w) <= windowMs) out.add(c.sourceId);
    }
    return out;
  });
}

/* ---- Records and retries ---------------------------------------------------------------------------- */

export interface RouteRecordInsert extends RecordInsert {
  failure?: string | undefined;
  retryAfterMs?: number | undefined;
  sourceVersion?: string | undefined;
}

/**
 * Stores one route's results (a fan-out job): records with their try number and next retry,
 * the cross-reference, resolved failures and usage. The run's totals come in finishRun.
 */
export async function insertRouteRecords(
  db: Database,
  tenantId: string,
  run: { id: string; flowId: string; kind: ClaimedRun['kind'] },
  results: RouteRecordInsert[],
  opts: { now?: Date; random?: () => number } = {},
): Promise<{ failed: number; needsAction: number; exhausted: number }> {
  const now = opts.now ?? new Date();
  const random = opts.random ?? Math.random;
  return withTenant(db, { tenantId }, async (tx) => {
    let needsAction = 0;
    let exhausted = 0;
    for (const r of results) {
      let attempts = 1;
      if (r.outcome === 'failed') {
        const [prev] = await tx
          .select({ attempts: runRecords.attempts })
          .from(runRecords)
          .where(
            and(
              eq(runRecords.flowId, run.flowId),
              eq(runRecords.routeId, r.routeId),
              eq(runRecords.sourceId, r.sourceId),
              eq(runRecords.outcome, 'failed'),
              isNull(runRecords.resolvedAt),
            ),
          )
          .orderBy(desc(runRecords.createdAt))
          .limit(1);
        attempts = (prev?.attempts ?? 0) + 1;
      }
      const nextRetryAt =
        r.outcome === 'failed'
          ? nextRecordRetry(now, attempts, r.failure, random(), r.retryAfterMs)
          : null;
      if (r.outcome === 'failed' && !nextRetryAt) {
        if (r.failure === 'invalid' || r.failure === 'mapping' || r.failure === 'dependency')
          needsAction++;
        else exhausted++;
      }
      // An earlier failed try of the same record is superseded by this one.
      if (r.outcome === 'failed')
        await tx
          .update(runRecords)
          .set({ nextRetryAt: null })
          .where(
            and(
              eq(runRecords.flowId, run.flowId),
              eq(runRecords.routeId, r.routeId),
              eq(runRecords.sourceId, r.sourceId),
              isNotNull(runRecords.nextRetryAt),
            ),
          );
      await tx.insert(runRecords).values({
        tenantId,
        runId: run.id,
        flowId: run.flowId,
        routeId: r.routeId,
        entity: r.entity,
        sourceId: r.sourceId,
        label: r.label,
        outcome: r.outcome,
        mode: r.mode,
        amountOre: r.amountOre,
        destinationId: r.destinationId,
        errorCode: r.errorCode,
        errorParams: r.errorParams,
        skipReason: r.skipReason,
        preview: r.preview,
        debug: r.debug,
        durationMs: r.durationMs,
        attempts,
        failure: r.failure ?? null,
        nextRetryAt,
        sourceVersion: r.sourceVersion ?? null,
        createdAt: now,
      });
    }
    const written = results.filter(
      (r) => (r.outcome === 'created' || r.outcome === 'updated') && r.mode !== 'test',
    );
    for (const r of written) {
      if (r.destinationId)
        await tx
          .insert(recordLinks)
          .values({
            tenantId,
            flowId: run.flowId,
            routeId: r.routeId,
            sourceId: r.sourceId,
            destinationId: r.destinationId,
          })
          .onConflictDoUpdate({
            target: [
              recordLinks.tenantId,
              recordLinks.flowId,
              recordLinks.routeId,
              recordLinks.sourceId,
            ],
            set: { destinationId: r.destinationId, updatedAt: now },
          });
      await tx
        .update(runRecords)
        .set({ resolvedAt: now, nextRetryAt: null })
        .where(
          and(
            eq(runRecords.flowId, run.flowId),
            eq(runRecords.routeId, r.routeId),
            eq(runRecords.sourceId, r.sourceId),
            eq(runRecords.outcome, 'failed'),
            isNull(runRecords.resolvedAt),
          ),
        );
    }
    await addUsageTx(tx, tenantId, written.length, now);
    return {
      failed: results.filter((r) => r.outcome === 'failed').length,
      needsAction,
      exhausted,
    };
  });
}

/** The flow's next automatic retry: the earliest open retry of any record. */
async function refreshNextRetry(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  flowId: string,
) {
  const [m] = await tx
    .select({ at: min(runRecords.nextRetryAt) })
    .from(runRecords)
    .where(
      and(
        eq(runRecords.flowId, flowId),
        isNotNull(runRecords.nextRetryAt),
        isNull(runRecords.resolvedAt),
      ),
    );
  await tx
    .update(flows)
    .set({ nextRetryAt: m?.at ?? null })
    .where(eq(flows.id, flowId));
}

/**
 * Finishes a fanned-out run: totals from its records, status, the flow's run times and next
 * retry. Safe to call twice.
 */
export async function finishRun(
  db: Database,
  tenantId: string,
  run: { id: string; flowId: string; kind: ClaimedRun['kind'] },
  opts: { pollMinutes: number; now?: Date },
): Promise<{ total: number; ok: number; failed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select({ outcome: runRecords.outcome, n: sql<number>`count(*)::int` })
      .from(runRecords)
      .where(eq(runRecords.runId, run.id))
      .groupBy(runRecords.outcome);
    const count = (o: RecordOutcome[]) =>
      rows.filter((r) => o.includes(r.outcome)).reduce((a, r) => a + r.n, 0);
    const total = rows.reduce((a, r) => a + r.n, 0);
    const failed = count(['failed']);
    const skipped = count(['skipped']);
    const ok = total - failed - skipped;
    const [r] = await tx
      .select({ startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.id, run.id));
    await tx
      .update(runs)
      .set({
        status: failed === 0 ? 'ok' : ok > 0 ? 'partial' : 'failed',
        finishedAt: now,
        recordsTotal: total,
        recordsOk: ok,
        recordsFailed: failed,
        recordsSkipped: skipped,
        durationMs: r ? Math.max(0, now.getTime() - r.startedAt.getTime()) : null,
      })
      .where(eq(runs.id, run.id));
    await tx
      .update(flows)
      .set(
        run.kind === 'retry'
          ? { lastRunAt: now }
          : { lastRunAt: now, nextRunAt: new Date(now.getTime() + opts.pollMinutes * 60_000) },
      )
      .where(eq(flows.id, run.flowId));
    await refreshNextRetry(tx, run.flowId);
    return { total, ok, failed, skipped };
  });
}

/** Failed records whose automatic retry is due, per route. */
export async function dueRetries(
  db: Database,
  tenantId: string,
  flowId: string,
  now = new Date(),
): Promise<{ routeId: string; entity: string; sourceId: string }[]> {
  return withTenant(db, { tenantId }, (tx) =>
    tx
      .selectDistinct({
        routeId: runRecords.routeId,
        entity: runRecords.entity,
        sourceId: runRecords.sourceId,
      })
      .from(runRecords)
      .where(
        and(
          eq(runRecords.flowId, flowId),
          isNull(runRecords.resolvedAt),
          isNotNull(runRecords.nextRetryAt),
          lte(runRecords.nextRetryAt, now),
        ),
      ),
  );
}

/** A queued run of the published version: an automatic retry, or one a webhook asked for. */
export async function createEngineRun(
  db: Database,
  tenantId: string,
  flowId: string,
  kind: 'retry' | 'webhook',
  sourceIds?: { entity: string; ids: string[] },
): Promise<string | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [f] = await tx
      .select({ versionId: flows.publishedVersionId, pausedAt: flows.pausedAt })
      .from(flows)
      .where(eq(flows.id, flowId));
    if (!f?.versionId || f.pausedAt) return null;
    // One automatic retry run at a time per flow.
    if (kind === 'retry') {
      const [busy] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.flowId, flowId),
            eq(runs.kind, 'retry'),
            inArray(runs.status, ['queued', 'running']),
            gte(runs.startedAt, new Date(Date.now() - 60 * 60_000)),
          ),
        )
        .limit(1);
      if (busy) return null;
    }
    const [r] = await tx
      .insert(runs)
      .values({
        tenantId,
        flowId,
        versionId: f.versionId,
        kind,
        status: 'queued',
        sourceIds: sourceIds ?? null,
      })
      .returning({ id: runs.id });
    return r!.id;
  });
}

/** Published flows whose source node reads this connection (webhook → runs). */
export async function flowsReading(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<{ flowId: string; definition: Record<string, unknown> }[]> {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx.execute<{ flow_id: string; definition: Record<string, unknown> }>(sql`
      select f.id as flow_id, v.definition
        from flows f join flow_versions v on v.id = f.published_version_id
       where f.paused_at is null
         and exists (
           select 1 from jsonb_array_elements(v.definition -> 'nodes') n
            where n ->> 'role' = 'source' and n ->> 'connectionId' = ${connectionId})`);
    return rows.rows.map((r) => ({ flowId: r.flow_id, definition: r.definition }));
  });
}

export async function failStaleRuns(db: Database, before: Date): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`select app.fail_stale_runs(${before.toISOString()}::timestamptz) as n`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function retentionSweep(
  db: Database,
  now = new Date(),
): Promise<Record<string, number>> {
  const res = await db.execute<{ r: Record<string, number> }>(
    sql`select app.retention_sweep(${now.toISOString()}::timestamptz) as r`,
  );
  return res.rows[0]?.r ?? {};
}

export interface LoadedRun extends ClaimedRun {
  status: string;
  startedAt: Date;
  requestedByName: string | null;
  sourceIds: { entity: string; ids: string[] } | null;
}

/** A run with its version, for the route and finish jobs (they don't claim it again). */
export async function loadRun(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<LoadedRun | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [r] = await tx.select().from(runs).where(eq(runs.id, runId));
    if (!r) return null;
    const [v] = await tx.select().from(flowVersions).where(eq(flowVersions.id, r.versionId));
    const [f] = await tx.select().from(flows).where(eq(flows.id, r.flowId));
    if (!v || !f) return null;
    return {
      id: r.id,
      flowId: r.flowId,
      kind: r.kind,
      versionId: r.versionId,
      definition: v.definition,
      flowName: f.name,
      flowPaused: f.pausedAt !== null,
      routePauses: f.routePauses,
      status: r.status,
      startedAt: r.startedAt,
      requestedByName: r.requestedByName,
      sourceIds: r.sourceIds ?? null,
    };
  });
}

/** Failed records of a run that will not be retried automatically (needs action or exhausted). */
export async function finalFailures(db: Database, tenantId: string, runId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(runRecords)
      .where(
        and(
          eq(runRecords.runId, runId),
          eq(runRecords.outcome, 'failed'),
          isNull(runRecords.nextRetryAt),
          isNull(runRecords.resolvedAt),
        ),
      );
    return r?.n ?? 0;
  });
}

/**
 * Records a webhook's delivery id; false when the same delivery was seen before (the sender
 * retried), so it is not processed twice.
 */
export async function markDelivery(
  db: Database,
  tenantId: string,
  eventId: string,
  deliveryId: string,
): Promise<boolean> {
  return withTenant(db, { tenantId }, async (tx) => {
    try {
      // A savepoint, so a duplicate doesn't abort the whole transaction.
      await tx.transaction((sp) =>
        sp.execute(sql`update inbound_events set delivery_id = ${deliveryId} where id = ${eventId}`),
      );
      return true;
    } catch (e) {
      if (String((e as { cause?: unknown }).cause ?? e).includes('inbound_events_delivery_key'))
        return false;
      throw e;
    }
  });
}
