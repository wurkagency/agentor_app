import { adapterFor, manifestFor, type ConnectorAdapter, type Entity } from '@agentor/connectors';
import {
  claimRun,
  completeRun,
  connectionsById,
  failRun,
  getLookups,
  linksFor,
  notify,
  openFailureIds,
  resolveNotifications,
  saveLookup,
  seenSourceIds,
  type RecordInsert,
} from '@agentor/db';
import { parseDefinition, runRoute, type FlowDefinition, type Route } from '@agentor/flows';
import { parseFlowJob } from '@agentor/jobs';
import { credentials, type ConnectionDeps } from './connections.js';

/** Records a test run reads: "Seneste 10 ordrer fra nordlys-cykler.dk" (D5). */
const TEST_LIMIT = 10;
/** Upper bound per entity for one scheduled poll. */
const POLL_LIMIT = 200;

export type FlowDeps = ConnectionDeps;

function isPaused(r: Route, pauses: Record<string, unknown>) {
  return r.paused || Boolean(pauses[r.id]);
}

/**
 * Executes one queued run (produktspecifikation §4.1): fetch from the source, fan out to every
 * route on the entity, filter, map and write in the route's mode, record each outcome.
 * Test runs never write (§5.4); retries only touch open failures.
 */
export async function processFlowJob(deps: FlowDeps, data: unknown) {
  const job = parseFlowJob(data);
  const started = Date.now();
  const run = await claimRun(deps.db, job.tenantId, job.runId);
  if (!run) return; // already handled (redelivery) or removed
  try {
    const def = parseDefinition(run.definition);
    // A retry run only ever touches open failures, whether or not the job names a route.
    const retry = job.retry ?? (run.kind === 'retry' ? {} : undefined);
    const results = await execute(deps, job.tenantId, run, def, retry);
    const { failed } = await completeRun(deps.db, job.tenantId, run, results, {
      pollMinutes: def.pollMinutes,
      startedAt: started,
    });
    if (run.kind === 'test') return;
    if (failed > 0) {
      await notify(deps.db, job.tenantId, {
        event: 'record_failed',
        messageKey: 'recordsFailed',
        params: { count: failed, flow: run.flowName },
        href: `/integrations/${run.flowId}?tab=runs&run=${run.id}`,
        needsAction: true,
        flowId: run.flowId,
      });
    } else if (run.kind === 'retry' || results.length > 0) {
      const open = await openFailureIds(deps.db, job.tenantId, run.flowId);
      if (open.length === 0)
        await resolveNotifications(deps.db, job.tenantId, { flowId: run.flowId });
    }
  } catch (e) {
    await failRun(deps.db, job.tenantId, run.id);
    throw e;
  }
}

async function execute(
  deps: FlowDeps,
  tenantId: string,
  run: Awaited<ReturnType<typeof claimRun>> & object,
  def: FlowDefinition,
  retry: { routeId?: string | undefined } | undefined,
): Promise<RecordInsert[]> {
  const isTest = run.kind === 'test';
  const source = def.nodes.find((n) => n.role === 'source');
  if (!source) return [];
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

  const routes = def.routes.filter(
    (r) => !isPaused(r, run.routePauses) && (!retry?.routeId || r.id === retry.routeId),
  );
  const retryIds = retry
    ? await openFailureIds(deps.db, tenantId, run.flowId, retry.routeId)
    : null;

  const src = await adapter(source.connectionId);
  const srcConn = conns.get(source.connectionId);
  const fetched = new Map<Entity, unknown[]>();
  const results: RecordInsert[] = [];
  for (const route of routes) {
    const dest = def.nodes.find((n) => n.id === route.to);
    const destConn = dest ? conns.get(dest.connectionId) : undefined;
    if (!src || !dest || !destConn || srcConn?.status === 'broken') continue;
    if (!fetched.has(route.entity))
      fetched.set(
        route.entity,
        await src.fetch(route.entity, { limit: isTest ? TEST_LIMIT : POLL_LIMIT }),
      );
    let records = fetched.get(route.entity)! as { sourceId: string }[];
    if (retryIds) {
      const ids = new Set(retryIds.filter((r) => r.routeId === route.id).map((r) => r.sourceId));
      records = records.filter((r) => ids.has(r.sourceId));
    } else if (!isTest) {
      const seen = await seenSourceIds(deps.db, tenantId, run.flowId, route.id);
      records = records.filter((r) => !seen.has(r.sourceId));
    }
    const mode = isTest ? 'test' : route.mode;

    // A broken destination: nothing is written, records wait (D10 "Venter · forbindelse afbrudt").
    if (destConn.status === 'broken') {
      if (!isTest)
        for (const r of records as { sourceId: string; number?: string; total?: number }[])
          results.push({
            routeId: route.id,
            entity: route.entity,
            sourceId: r.sourceId,
            label: r.number ? `#${r.number}` : r.sourceId,
            outcome: 'waiting',
            mode,
            amountOre: typeof r.total === 'number' ? r.total : null,
            destinationId: null,
            errorCode: 'CONNECTION_BROKEN',
            errorParams: {
              connector: manifestFor(destConn.connectorId)?.name ?? destConn.connectorId,
            },
            skipReason: null,
            preview: null,
            debug: null,
            durationMs: 0,
          });
      continue;
    }

    const destAdapter = (await adapter(dest.connectionId))!;
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
      records: records as never,
      destination: destAdapter,
      accounts: lookups.accounts,
      dryRun: isTest,
      existingId: (id) => links.get(id) ?? null,
    });
    for (const r of out)
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
      });
  }
  return results;
}
