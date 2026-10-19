import {
  adapterFor,
  changedAt,
  manifestFor,
  sourceVersion,
  WriteError,
  type ConnectorAdapter,
  type Entity,
  type EntityRecord,
  type WriteMode,
} from '@agentor/connectors';
import { POLL_OVERLAP_MS, RATE_LIMIT_FALLBACK_MS } from '@agentor/core';
import {
  advanceCursor,
  claimRun,
  claimVersions,
  completeRun,
  connectionsById,
  deletePayloads,
  dueRetries,
  echoes,
  failRun,
  finalFailures,
  findLinks,
  finishRun,
  getCursor,
  getLookups,
  insertRouteRecords,
  linksFor,
  loadPayloads,
  loadRun,
  notify,
  openFailureIds,
  resolveNotifications,
  saveLink,
  saveLookup,
  storePayloads,
  type RecordInsert,
  type RouteRecordInsert,
} from '@agentor/db';
import { parseDefinition, runRoute, type FlowDefinition, type Route } from '@agentor/flows';
import {
  enqueueRouteJobs,
  parseFlowJob,
  parseFlowJobOf,
  takeToken,
  type FlowJobName,
} from '@agentor/jobs';
import type { FlowProducer } from 'bullmq';
import type { Redis } from 'ioredis';
import { credentials, type ConnectionDeps } from './connections.js';
import { metrics } from './metrics.js';

/** Records a test run reads: "Seneste 10 ordrer fra nordlys-cykler.dk" (D5). */
const TEST_LIMIT = 10;
/** Upper bound per entity for one poll; the cursor picks up the rest next time. */
const POLL_LIMIT = 200;
/** Writes per minute per customer, across all of its destinations. */
const TENANT_PER_MINUTE = 600;
/** Longest a write waits in the job for a rate limit before the record is retried later. */
const MAX_INLINE_WAIT_MS = 30_000;

export interface FlowDeps extends ConnectionDeps {
  producer: FlowProducer;
  redis: Redis;
}

const MODE: Record<Route['mode'], WriteMode> = { test: 'dry_run', draft: 'draft', live: 'live' };

function isPaused(r: Route, pauses: Record<string, unknown>) {
  return r.paused || Boolean(pauses[r.id]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Adapters for a run's connections, opened lazily with the connection's credentials. */
async function engineContext(deps: FlowDeps, tenantId: string, def: FlowDefinition) {
  const conns = new Map(
    (
      await connectionsById(
        deps.db,
        tenantId,
        def.nodes.map((n) => n.connectionId),
      )
    ).map((c) => [c.id, c]),
  );
  const adapters = new Map<string, ConnectorAdapter>();
  const adapter = async (connectionId: string) => {
    const c = conns.get(connectionId);
    if (!c) return null;
    if (!adapters.has(connectionId)) {
      const creds = (await credentials(deps, tenantId, connectionId)) ?? {};
      adapters.set(
        connectionId,
        adapterFor({ connectorId: c.connectorId, credentials: creds, mode: deps.connectorMode }),
      );
    }
    return adapters.get(connectionId)!;
  };
  return { conns, adapter };
}

export async function processFlowJobByName(deps: FlowDeps, name: string, data: unknown) {
  const started = Date.now();
  let result = 'ok';
  try {
    switch (name as FlowJobName) {
      case 'flow.run':
        return await processFlowJob(deps, data);
      case 'flow.route':
        return await processRouteJob(deps, parseFlowJobOf('flow.route', data));
      case 'flow.finish':
        return await processFinishJob(deps, parseFlowJobOf('flow.finish', data));
      default:
        throw new Error(`unknown flow job ${name}`);
    }
  } catch (e) {
    result = 'error';
    throw e;
  } finally {
    metrics.inc('agentor_jobs_total', { queue: 'flows', name, result });
    metrics.observe('agentor_job_seconds', { queue: 'flows', name }, (Date.now() - started) / 1000);
  }
}

/**
 * Stage 1 of a run (produktspecifikation §4.1): read what changed at the source, drop versions
 * the flow has already seen and our own writes coming back, store the records, and fan out to
 * one job per route. Test runs stay in one job: they never write and must answer quickly.
 */
export async function processFlowJob(deps: FlowDeps, data: unknown) {
  const job = parseFlowJob(data);
  const run = await claimRun(deps.db, job.tenantId, job.runId);
  if (!run) return; // already handled (redelivery) or removed
  try {
    const def = parseDefinition(run.definition);
    if (run.kind === 'test') return await testRun(deps, job.tenantId, run, def);
    const loaded = await loadRun(deps.db, job.tenantId, run.id);
    const ctx = await engineContext(deps, job.tenantId, def);
    const routes = def.routes.filter(
      (r) => !isPaused(r, run.routePauses) && (!job.retry?.routeId || r.id === job.retry.routeId),
    );
    const source = def.nodes.find((n) => n.role === 'source');
    const srcConn = source ? ctx.conns.get(source.connectionId) : undefined;
    const src = source ? await ctx.adapter(source.connectionId) : null;
    const routeIds: string[] = [];
    if (source && src && srcConn && srcConn.status !== 'broken') {
      // Retries read exactly the records that failed; manual "Gentag" takes every open failure.
      const retryTargets =
        run.kind !== 'retry'
          ? null
          : job.retry || loaded?.requestedByName
            ? await openFailureIds(deps.db, job.tenantId, run.flowId, job.retry?.routeId)
            : await dueRetries(deps.db, job.tenantId, run.flowId);
      const entities = [...new Set(routes.map((r) => r.entity))];
      for (const entity of entities) {
        const key = { flowId: run.flowId, connectionId: source.connectionId, entity };
        let records: EntityRecord[Entity][] = [];
        let nextCursor: Date | null = null;
        if (retryTargets) {
          const ids = [
            ...new Set(
              retryTargets
                .filter((t) => routes.find((r) => r.id === t.routeId)?.entity === entity)
                .map((t) => t.sourceId),
            ),
          ];
          records = (await Promise.all(ids.map((id) => src.get(entity, id)))).filter(
            (r): r is EntityRecord[Entity] => r !== null,
          );
        } else if (loaded?.sourceIds) {
          if (loaded.sourceIds.entity !== entity) continue;
          records = (
            await Promise.all(loaded.sourceIds.ids.map((id) => src.get(entity, id)))
          ).filter((r): r is EntityRecord[Entity] => r !== null);
        } else {
          const cursor = await getCursor(deps.db, job.tenantId, key);
          const since = cursor ? new Date(cursor.getTime() - POLL_OVERLAP_MS).toISOString() : null;
          records = await src.fetch(entity, { limit: POLL_LIMIT, since });
          const latest = records
            .map((r) => changedAt(r))
            .filter((x): x is string => x !== null)
            .sort()
            .at(-1);
          nextCursor = latest ? new Date(latest) : null;
        }
        const withVersion = records.map((r) => ({
          record: r,
          sourceId: (r as { sourceId: string }).sourceId,
          version: sourceVersion(r),
        }));
        let keep = withVersion;
        if (!retryTargets) {
          // Echo suppression: a change Agentor wrote itself must not sync back.
          const echo = await echoes(
            deps.db,
            job.tenantId,
            source.connectionId,
            withVersion.map((w) => ({ sourceId: w.sourceId, changedAt: changedAt(w.record) })),
          );
          if (echo.size) metrics.inc('agentor_echoes_total', {}, echo.size);
          keep = keep.filter((w) => !echo.has(w.sourceId));
          // Idempotency key: each version of a record runs once per flow.
          const fresh = await claimVersions(
            deps.db,
            job.tenantId,
            { ...key, runId: run.id },
            keep.map((w) => ({ sourceId: w.sourceId, version: w.version })),
          );
          const dupes = keep.length - fresh.size;
          if (dupes > 0) metrics.inc('agentor_duplicates_total', {}, dupes);
          keep = keep.filter((w) => fresh.has(w.sourceId));
        }
        await storePayloads(
          deps.db,
          job.tenantId,
          run.id,
          entity,
          keep.map((w) => ({ sourceId: w.sourceId, version: w.version, payload: w.record })),
        );
        if (keep.length)
          routeIds.push(...routes.filter((r) => r.entity === entity).map((r) => r.id));
        if (nextCursor) await advanceCursor(deps.db, job.tenantId, key, nextCursor);
      }
    }
    if (routeIds.length === 0) {
      await finishRun(deps.db, job.tenantId, run, { pollMinutes: def.pollMinutes });
      return;
    }
    await enqueueRouteJobs(deps.producer, { tenantId: job.tenantId, runId: run.id, routeIds });
  } catch (e) {
    await failRun(deps.db, job.tenantId, run.id);
    throw e;
  }
}

/**
 * Stage 2: one route of a run. Filter, map, resolve dependencies in the destination, wait for
 * the rate limit, write in the route's mode, and record each outcome with its retry plan.
 */
async function processRouteJob(
  deps: FlowDeps,
  job: { tenantId: string; runId: string; routeId: string },
) {
  const run = await loadRun(deps.db, job.tenantId, job.runId);
  if (!run || run.status !== 'running') return;
  const def = parseDefinition(run.definition);
  const route = def.routes.find((r) => r.id === job.routeId);
  if (!route) return;
  const source = def.nodes.find((n) => n.role === 'source');
  const dest = def.nodes.find((n) => n.id === route.to);
  if (!source || !dest) return;
  const ctx = await engineContext(deps, job.tenantId, def);
  const destConn = ctx.conns.get(dest.connectionId);
  if (!destConn) return;

  let payloads = await loadPayloads(deps.db, job.tenantId, run.id, route.entity);
  if (run.kind === 'retry') {
    const open = new Set(
      (await openFailureIds(deps.db, job.tenantId, run.flowId, route.id)).map((f) => f.sourceId),
    );
    payloads = payloads.filter((p) => open.has(p.sourceId));
  }
  // A record that already succeeded on this route in this run (a repeated job) is not redone.
  const versionOf = new Map(payloads.map((p) => [p.sourceId, p.version]));
  const records = payloads.map((p) => p.payload) as EntityRecord[Entity][];
  const mode = route.mode;

  let results: RouteRecordInsert[];
  if (destConn.status === 'broken') {
    // A broken destination: nothing is written, records wait (D10 "Venter · forbindelse afbrudt").
    results = (records as { sourceId: string; number?: string; total?: number }[]).map((r) => ({
      routeId: route.id,
      entity: route.entity,
      sourceId: r.sourceId,
      label: r.number ? `#${r.number}` : r.sourceId,
      outcome: 'waiting' as const,
      mode,
      amountOre: typeof r.total === 'number' ? r.total : null,
      destinationId: null,
      errorCode: 'CONNECTION_BROKEN',
      errorParams: { connector: manifestFor(destConn.connectorId)?.name ?? destConn.connectorId },
      skipReason: null,
      preview: null,
      debug: null,
      durationMs: 0,
      sourceVersion: versionOf.get(r.sourceId),
    }));
  } else {
    const destAdapter = (await ctx.adapter(dest.connectionId))!;
    const srcAdapter = await ctx.adapter(source.connectionId);
    const manifest = manifestFor(destConn.connectorId);
    let lookups = await getLookups(deps.db, job.tenantId, dest.connectionId);
    if (!lookups.accounts && manifest?.mapping?.[route.targetEntity]) {
      const accounts = await destAdapter.lookup('accounts');
      await saveLookup(deps.db, job.tenantId, dest.connectionId, 'accounts', accounts);
      lookups = { ...lookups, accounts };
    }
    const links = await linksFor(deps.db, job.tenantId, run.flowId, route.id);
    const perMinute = manifest?.rateLimit.perMinute ?? 60;

    const beforeWrite = async () => {
      for (;;) {
        const wait = Math.max(
          await takeToken(deps.redis, `conn:${dest.connectionId}`, perMinute),
          await takeToken(deps.redis, `tenant:${job.tenantId}`, TENANT_PER_MINUTE),
        );
        if (wait === 0) return;
        metrics.inc('agentor_rate_limit_waits_total');
        if (wait > MAX_INLINE_WAIT_MS)
          throw new WriteError(
            'rate limit',
            'rate_limited',
            Math.max(wait, RATE_LIMIT_FALLBACK_MS),
          );
        await sleep(wait);
      }
    };

    const depsOf = manifest?.dependencies?.[route.targetEntity] ?? [];
    const resolveDependencies = async (rec: EntityRecord[Entity]) => {
      const refs: Record<string, string> = {};
      for (const dep of depsOf) {
        const items: { id: string; record: unknown | null }[] =
          dep === 'customer' && 'customer' in rec
            ? [{ id: rec.customer.sourceId, record: rec.customer }]
            : dep === 'product' && 'lines' in rec
              ? [
                  ...new Set(
                    rec.lines.map((l) => l.productId).filter((x): x is string => Boolean(x)),
                  ),
                ].map((id) => ({ id, record: null }))
              : [];
        if (items.length === 0) continue;
        const known = await findLinks(
          deps.db,
          job.tenantId,
          { connectionId: dest.connectionId, entity: dep, sourceConnectionId: source.connectionId },
          items.map((i) => i.id),
        );
        for (const item of items) {
          const hit = known.get(item.id);
          if (hit) {
            refs[`${dep}:${item.id}`] = hit;
            continue;
          }
          const record = item.record ?? (srcAdapter ? await srcAdapter.get(dep, item.id) : null);
          if (!record) return { missing: dep, reason: `${dep} ${item.id} not found at the source` };
          try {
            await beforeWrite();
            const w = await destAdapter.write(dep, record as never, { mode: MODE[route.mode] });
            if (w.destinationId) {
              await saveLink(deps.db, job.tenantId, {
                connectionId: dest.connectionId,
                entity: dep,
                sourceConnectionId: source.connectionId,
                sourceId: item.id,
                destinationId: w.destinationId,
              });
              refs[`${dep}:${item.id}`] = w.destinationId;
            }
          } catch (e) {
            // Only rejected data needs the customer; anything else is retried with the record.
            if (e instanceof WriteError && e.kind !== 'invalid') throw e;
            return { missing: dep, reason: e instanceof Error ? e.message : 'rejected' };
          }
        }
      }
      return { refs };
    };

    const out = await runRoute({
      def,
      route,
      records: records as never,
      destination: destAdapter,
      accounts: lookups.accounts,
      dryRun: false,
      existingId: (id) => links.get(id) ?? null,
      resolveDependencies,
      beforeWrite,
    });
    results = [];
    for (const r of out) {
      if ((r.outcome === 'created' || r.outcome === 'updated') && r.destinationId)
        await saveLink(deps.db, job.tenantId, {
          connectionId: dest.connectionId,
          entity: route.targetEntity,
          sourceConnectionId: source.connectionId,
          sourceId: r.sourceId,
          destinationId: r.destinationId,
        });
      metrics.inc('agentor_records_total', { outcome: r.outcome, failure: r.failure ?? 'none' });
      results.push({
        routeId: r.routeId,
        entity: route.entity,
        sourceId: r.sourceId,
        label: r.label,
        outcome: r.outcome,
        mode,
        amountOre: r.amount,
        destinationId: r.destinationId,
        errorCode: r.errorCode,
        errorParams: r.errorParams,
        skipReason: r.skipReason,
        preview: r.preview,
        debug: r.errorCode
          ? { code: r.errorCode, request: { route: `${route.entity} → ${route.targetEntity}` } }
          : null,
        durationMs: r.durationMs,
        failure: r.failure,
        retryAfterMs: r.retryAfterMs,
        sourceVersion: versionOf.get(r.sourceId),
      });
    }
  }
  await insertRouteRecords(deps.db, job.tenantId, run, results);
}

/** Stage 3: every route is done. Totals, status, notifications; the payloads are deleted. */
async function processFinishJob(deps: FlowDeps, job: { tenantId: string; runId: string }) {
  const run = await loadRun(deps.db, job.tenantId, job.runId);
  if (!run || run.status !== 'running') return;
  const def = parseDefinition(run.definition);
  const totals = await finishRun(deps.db, job.tenantId, run, { pollMinutes: def.pollMinutes });
  await deletePayloads(deps.db, job.tenantId, run.id);
  const final = await finalFailures(deps.db, job.tenantId, run.id);
  if (final > 0) {
    // Only what won't fix itself needs the customer; transient failures are retried quietly.
    await notify(deps.db, job.tenantId, {
      event: 'record_failed',
      messageKey: 'recordsFailed',
      params: { count: final, flow: run.flowName },
      href: `/integrations/${run.flowId}?tab=runs&run=${run.id}`,
      needsAction: true,
      flowId: run.flowId,
    });
  } else if (totals.failed === 0) {
    const open = await openFailureIds(deps.db, job.tenantId, run.flowId);
    if (open.length === 0)
      await resolveNotifications(deps.db, job.tenantId, { flowId: run.flowId });
  }
}

/**
 * Test run (D5): reads the newest records and runs every route as a dry run in one job, so the
 * editor gets its answer at once. Nothing is written and no cursor or key moves.
 */
async function testRun(
  deps: FlowDeps,
  tenantId: string,
  run: NonNullable<Awaited<ReturnType<typeof claimRun>>>,
  def: FlowDefinition,
) {
  const started = Date.now();
  const ctx = await engineContext(deps, tenantId, def);
  const source = def.nodes.find((n) => n.role === 'source');
  const results: RecordInsert[] = [];
  if (source) {
    const src = await ctx.adapter(source.connectionId);
    const srcConn = ctx.conns.get(source.connectionId);
    const fetched = new Map<Entity, unknown[]>();
    for (const route of def.routes.filter((r) => !isPaused(r, run.routePauses))) {
      const dest = def.nodes.find((n) => n.id === route.to);
      const destConn = dest ? ctx.conns.get(dest.connectionId) : undefined;
      if (!src || !dest || !destConn || srcConn?.status === 'broken') continue;
      if (destConn.status === 'broken') continue;
      if (!fetched.has(route.entity))
        fetched.set(route.entity, await src.fetch(route.entity, { limit: TEST_LIMIT }));
      const destAdapter = (await ctx.adapter(dest.connectionId))!;
      let lookups = await getLookups(deps.db, tenantId, dest.connectionId);
      if (!lookups.accounts && manifestFor(destConn.connectorId)?.mapping?.[route.targetEntity]) {
        const accounts = await destAdapter.lookup('accounts');
        await saveLookup(deps.db, tenantId, dest.connectionId, 'accounts', accounts);
        lookups = { ...lookups, accounts };
      }
      const links = await linksFor(deps.db, tenantId, run.flowId, route.id);
      const out = await runRoute({
        def,
        route,
        records: fetched.get(route.entity) as never,
        destination: destAdapter,
        accounts: lookups.accounts,
        dryRun: true,
        existingId: (id) => links.get(id) ?? null,
      });
      for (const r of out)
        results.push({
          routeId: r.routeId,
          entity: route.entity,
          sourceId: r.sourceId,
          label: r.label,
          outcome: r.outcome,
          mode: 'test',
          amountOre: r.amount,
          destinationId: r.destinationId,
          errorCode: r.errorCode,
          errorParams: r.errorParams,
          skipReason: r.skipReason,
          preview: r.preview,
          debug: r.errorCode
            ? { code: r.errorCode, request: { route: `${route.entity} → ${route.targetEntity}` } }
            : null,
          durationMs: r.durationMs,
        });
    }
  }
  await completeRun(deps.db, tenantId, run, results, {
    pollMinutes: def.pollMinutes,
    startedAt: started,
  });
}
