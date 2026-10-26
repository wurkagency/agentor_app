/**
 * Connection health (PLAN-INTEGRATIONS-WOO-DINERO §4.5, §5.1): live connections are tested again
 * every hour. The test refreshes OAuth tokens before they lapse and switches webhooks a shop
 * disabled back on, so a quiet failure doesn't go unnoticed until the next order is missing.
 */
export interface ConnectionTickDeps {
  isLeader: () => boolean;
  due: (before: Date) => Promise<{ tenantId: string; connectionId: string }[]>;
  enqueue: (tenantId: string, connectionId: string, jobId: string) => Promise<void>;
}

export const CONNECTION_INTERVAL_MS = 15 * 60_000;
export const CONNECTION_MAX_AGE_MS = 60 * 60_000;

export async function connectionTick(deps: ConnectionTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  const due = await deps.due(new Date(now.getTime() - CONNECTION_MAX_AGE_MS));
  // One job per connection per interval, even if two schedulers overlap during a deploy.
  const slot = Math.floor(now.getTime() / CONNECTION_INTERVAL_MS);
  for (const c of due)
    await deps.enqueue(c.tenantId, c.connectionId, `health-${c.connectionId}-${slot}`);
  return due.length;
}
