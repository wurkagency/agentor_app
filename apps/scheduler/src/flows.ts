/**
 * Polling (produktspecifikation §10.1): the leader finds published flows whose next poll is due,
 * and flows with failed records whose automatic retry is due, and queues one run each. The
 * worker moves next_run_at and next_retry_at after every run, so nothing is queued twice.
 */
export interface FlowTickDeps {
  isLeader: () => boolean;
  dueFlows: (
    now: Date,
  ) => Promise<{ tenantId: string; flowId: string; kind?: 'scheduled' | 'retry' }[]>;
  createRun: (
    tenantId: string,
    flowId: string,
    kind: 'scheduled' | 'retry',
  ) => Promise<string | null>;
  enqueue: (tenantId: string, runId: string) => Promise<void>;
}

export async function flowTick(deps: FlowTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  let n = 0;
  for (const f of await deps.dueFlows(now)) {
    const runId = await deps.createRun(f.tenantId, f.flowId, f.kind ?? 'scheduled');
    if (!runId) continue;
    await deps.enqueue(f.tenantId, runId);
    n++;
  }
  return n;
}

export const FLOW_INTERVAL_MS = 60_000;
/** Runs left "running" this long by a worker that died are failed, so the flow moves on. */
export const STALE_RUN_MS = 60 * 60_000;
export const HOUSEKEEPING_INTERVAL_MS = 5 * 60_000;
/** Retention runs once a day (produktspecifikation §9.6). */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;
