/**
 * Monthly QuickPay charges (produktspecifikation §10.1): the leader asks the database which
 * subscriptions are due and enqueues one charge job per tenant. The job id is per tenant and
 * day, and the worker is idempotent per billing period, so overlapping runs never bill twice.
 */
export interface BillingTickDeps {
  isLeader: () => boolean;
  dueSubscriptions: (now: Date) => Promise<string[]>;
  enqueueCharge: (tenantId: string, jobId: string) => Promise<void>;
}

export async function billingTick(deps: BillingTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  const due = await deps.dueSubscriptions(now);
  const day = now.toISOString().slice(0, 10);
  for (const tenantId of due) await deps.enqueueCharge(tenantId, `charge-${tenantId}-${day}`);
  return due.length;
}

export const BILLING_INTERVAL_MS = 15 * 60_000;
