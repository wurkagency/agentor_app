/**
 * Polling (produktspecifikation §10.1): the leader finds published flows whose next poll is due
 * and queues one run each. The worker sets next_run_at after every run, so a flow is never
 * queued twice while a run is pending.
 */
export interface FlowTickDeps {
  isLeader: () => boolean;
  dueFlows: (now: Date) => Promise<{ tenantId: string; flowId: string }[]>;
  createRun: (tenantId: string, flowId: string) => Promise<string | null>;
  enqueue: (tenantId: string, runId: string) => Promise<void>;
}

export async function flowTick(deps: FlowTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  let n = 0;
  for (const f of await deps.dueFlows(now)) {
    const runId = await deps.createRun(f.tenantId, f.flowId);
    if (!runId) continue;
    await deps.enqueue(f.tenantId, runId);
    n++;
  }
  return n;
}

export const FLOW_INTERVAL_MS = 60_000;
