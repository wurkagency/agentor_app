import { billingPeriod } from '@agentor/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withTenant, type Database, type Transaction } from '../client.js';
import {
  connectionLookups,
  connections,
  flows,
  flowVersions,
  memberships,
  notificationPrefs,
  notifications,
  recordLinks,
  runRecords,
  runs,
  subscriptions,
  tenants,
  usageCounters,
  type NotificationEvent,
  type RecordOutcome,
} from '../schema/index.js';
import { loadPlansTx } from './billing.js';
import { CRITICAL_EVENTS, DEFAULT_PREFS } from './settings.js';

/**
 * Worker-side persistence for the engine (produktspecifikation §4.1 step 6): runs, records,
 * the cross-reference, usage counting and notifications. Every call re-enters the tenant from
 * the job and re-reads what it needs (§9.3).
 */

export interface ClaimedRun {
  id: string;
  flowId: string;
  kind: 'scheduled' | 'webhook' | 'manual' | 'test' | 'retry';
  versionId: string;
  definition: Record<string, unknown>;
  flowName: string;
  flowPaused: boolean;
  routePauses: Record<string, { at: string; by: string }>;
}

export async function claimRun(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<ClaimedRun | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [r] = await tx
      .update(runs)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
      .returning();
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
    };
  });
}

/** A scheduled run for a published flow (created by the worker, not by a user). */
export async function createScheduledRun(db: Database, tenantId: string, flowId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const [f] = await tx
      .select({ versionId: flows.publishedVersionId, pausedAt: flows.pausedAt })
      .from(flows)
      .where(eq(flows.id, flowId));
    if (!f?.versionId || f.pausedAt) return null;
    const [r] = await tx
      .insert(runs)
      .values({ tenantId, flowId, versionId: f.versionId, kind: 'scheduled', status: 'queued' })
      .returning({ id: runs.id });
    return r!.id;
  });
}

export async function connectionsById(db: Database, tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return withTenant(db, { tenantId }, (tx) =>
    tx
      .select({
        id: connections.id,
        connectorId: connections.connectorId,
        status: connections.status,
        name: connections.name,
      })
      .from(connections)
      .where(inArray(connections.id, ids)),
  );
}

export async function getLookups(db: Database, tenantId: string, connectionId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select()
      .from(connectionLookups)
      .where(eq(connectionLookups.connectionId, connectionId));
    return Object.fromEntries(rows.map((r) => [r.list, r.options])) as Partial<
      Record<'accounts' | 'vatCodes' | 'templates', { value: string; label: string }[]>
    >;
  });
}

export async function saveLookup(
  db: Database,
  tenantId: string,
  connectionId: string,
  list: 'accounts' | 'vatCodes' | 'templates',
  options: { value: string; label: string }[],
) {
  await withTenant(db, { tenantId }, (tx) =>
    tx
      .insert(connectionLookups)
      .values({ tenantId, connectionId, list, options })
      .onConflictDoUpdate({
        target: [
          connectionLookups.tenantId,
          connectionLookups.connectionId,
          connectionLookups.list,
        ],
        set: { options, fetchedAt: new Date() },
      }),
  );
}

/** destination ids by source id for a route (the cross-reference). */
export async function linksFor(db: Database, tenantId: string, flowId: string, routeId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select({ sourceId: recordLinks.sourceId, destinationId: recordLinks.destinationId })
      .from(recordLinks)
      .where(and(eq(recordLinks.flowId, flowId), eq(recordLinks.routeId, routeId)));
    return new Map(rows.map((r) => [r.sourceId, r.destinationId]));
  });
}

/**
 * Source ids a route has already processed outside test runs. Polls skip them, as a real source
 * would with an updated-since cursor; failures are picked up by retries instead.
 */
export async function seenSourceIds(
  db: Database,
  tenantId: string,
  flowId: string,
  routeId: string,
) {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .selectDistinct({ sourceId: runRecords.sourceId })
      .from(runRecords)
      .where(
        and(
          eq(runRecords.flowId, flowId),
          eq(runRecords.routeId, routeId),
          sql`${runRecords.mode} <> 'test'`,
        ),
      );
    return new Set(rows.map((r) => r.sourceId));
  });
}

/** Source ids with an open failure on a route (what "Gentag" retries). */
export async function openFailureIds(
  db: Database,
  tenantId: string,
  flowId: string,
  routeId?: string,
) {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .selectDistinct({ routeId: runRecords.routeId, sourceId: runRecords.sourceId })
      .from(runRecords)
      .where(
        and(
          eq(runRecords.flowId, flowId),
          eq(runRecords.outcome, 'failed'),
          isNull(runRecords.resolvedAt),
          routeId ? eq(runRecords.routeId, routeId) : undefined,
        ),
      );
    return rows;
  });
}

export interface RecordInsert {
  routeId: string;
  entity: string;
  sourceId: string;
  label: string;
  outcome: RecordOutcome;
  mode: 'test' | 'draft' | 'live';
  amountOre: number | null;
  destinationId: string | null;
  errorCode: string | null;
  errorParams: Record<string, string> | null;
  skipReason: string | null;
  preview: unknown;
  debug: unknown;
  durationMs: number;
}

/** Counts successful Live writes towards the month's transactions (D2). */
export async function addUsageTx(tx: Transaction, tenantId: string, n: number, now: Date) {
  if (n <= 0) return;
  const [t] = await tx.select({ tz: tenants.timeZone }).from(tenants).limit(1);
  const period = billingPeriod(now, t?.tz);
  const [row] = await tx
    .insert(usageCounters)
    .values({ tenantId, period, transactions: n })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.period],
      set: { transactions: sql`${usageCounters.transactions} + ${n}`, updatedAt: now },
    })
    .returning({ transactions: usageCounters.transactions, exceededAt: usageCounters.exceededAt });
  if (!row || row.exceededAt) return;
  const [sub] = await tx.select({ planId: subscriptions.planId }).from(subscriptions).limit(1);
  const plan = sub ? (await loadPlansTx(tx)).find((p) => p.id === sub.planId) : undefined;
  const limit = plan?.entitlements.transactionsPerMonth;
  if (limit !== undefined && limit !== null && row.transactions >= limit)
    await tx
      .update(usageCounters)
      .set({ exceededAt: now })
      .where(and(eq(usageCounters.period, period), isNull(usageCounters.exceededAt)));
}

/**
 * Stores a run's results in one transaction: records, cross-reference, resolved failures,
 * counters, the flow's run times and usage (successful Live writes, D2).
 */
export async function completeRun(
  db: Database,
  tenantId: string,
  run: { id: string; flowId: string; kind: ClaimedRun['kind'] },
  results: RecordInsert[],
  opts: { pollMinutes: number; startedAt: number; now?: Date },
): Promise<{ failed: number; ok: number }> {
  const now = opts.now ?? new Date();
  return withTenant(db, { tenantId }, async (tx) => {
    if (results.length) {
      await tx.insert(runRecords).values(
        results.map((r) => ({
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
          createdAt: now,
        })),
      );
    }
    const isTest = run.kind === 'test';
    const written = results.filter(
      (r) => (r.outcome === 'created' || r.outcome === 'updated') && r.mode !== 'test',
    );
    if (!isTest) {
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
        // A success resolves earlier failures of the same record on the same route.
        await tx
          .update(runRecords)
          .set({ resolvedAt: now })
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
      await tx
        .update(flows)
        .set({ lastRunAt: now, nextRunAt: new Date(now.getTime() + opts.pollMinutes * 60_000) })
        .where(eq(flows.id, run.flowId));
    }
    const failed = results.filter((r) => r.outcome === 'failed').length;
    const skipped = results.filter((r) => r.outcome === 'skipped').length;
    const ok = results.length - failed - skipped;
    await tx
      .update(runs)
      .set({
        status: isTest ? 'test' : failed === 0 ? 'ok' : ok > 0 ? 'partial' : 'failed',
        finishedAt: now,
        recordsTotal: results.length,
        recordsOk: ok,
        recordsFailed: failed,
        recordsSkipped: skipped,
        durationMs: Math.max(0, now.getTime() - opts.startedAt),
      })
      .where(eq(runs.id, run.id));
    return { failed, ok };
  });
}

export async function failRun(db: Database, tenantId: string, runId: string) {
  await withTenant(db, { tenantId }, (tx) =>
    tx.update(runs).set({ status: 'failed', finishedAt: new Date() }).where(eq(runs.id, runId)),
  );
}

/**
 * In-app notification for every member who wants it (preferences per user, critical events are
 * always shown). Repeats of an unresolved notification for the same flow/connection are skipped.
 */
export async function notify(
  db: Database,
  tenantId: string,
  n: {
    event: NotificationEvent;
    messageKey: string;
    params: Record<string, string | number>;
    href: string;
    needsAction: boolean;
    flowId?: string | undefined;
    connectionId?: string | undefined;
  },
): Promise<number> {
  return withTenant(db, { tenantId }, async (tx) => {
    const members = await tx.select({ userId: memberships.userId }).from(memberships);
    const prefs = await tx
      .select({ userId: notificationPrefs.userId, inApp: notificationPrefs.inApp })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.event, n.event));
    const critical = CRITICAL_EVENTS.includes(n.event);
    let created = 0;
    for (const m of members) {
      const pref = prefs.find((p) => p.userId === m.userId);
      const wants = critical || (pref ? pref.inApp : DEFAULT_PREFS[n.event].inApp);
      if (!wants) continue;
      const [dup] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, m.userId),
            eq(notifications.messageKey, n.messageKey),
            isNull(notifications.resolvedAt),
            n.flowId ? eq(notifications.flowId, n.flowId) : undefined,
            n.connectionId ? eq(notifications.connectionId, n.connectionId) : undefined,
          ),
        )
        .limit(1);
      if (dup) continue;
      await tx.insert(notifications).values({
        tenantId,
        userId: m.userId,
        event: n.event,
        needsAction: n.needsAction,
        messageKey: n.messageKey,
        params: n.params,
        href: n.href,
        flowId: n.flowId ?? null,
        connectionId: n.connectionId ?? null,
      });
      created++;
    }
    return created;
  });
}

/** Marks notifications resolved when the cause is gone (flow errors retried, connection fixed). */
export async function resolveNotifications(
  db: Database,
  tenantId: string,
  where: { flowId?: string; connectionId?: string; messageKey?: string },
) {
  await withTenant(db, { tenantId }, (tx) =>
    tx
      .update(notifications)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          isNull(notifications.resolvedAt),
          where.flowId ? eq(notifications.flowId, where.flowId) : undefined,
          where.connectionId ? eq(notifications.connectionId, where.connectionId) : undefined,
          where.messageKey ? eq(notifications.messageKey, where.messageKey) : undefined,
        ),
      ),
  );
}

/** Published, unpaused flows whose next poll is due, across tenants (scheduler). */
export async function dueFlows(db: Database, now = new Date()) {
  const res = await db.execute<{ tenant_id: string; flow_id: string; kind: 'scheduled' | 'retry' }>(
    sql`select * from app.due_flows(${now.toISOString()}::timestamptz)`,
  );
  return res.rows.map((r) => ({ tenantId: r.tenant_id, flowId: r.flow_id, kind: r.kind }));
}
