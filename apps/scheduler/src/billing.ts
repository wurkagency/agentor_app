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

export interface InvoiceTickDeps {
  isLeader: () => boolean;
  dueInvoiceJobs: (
    now: Date,
  ) => Promise<{ tenantId: string; invoiceId: string; job: 'send' | 'retry' }[]>;
  enqueue: (
    job: 'send' | 'retry',
    tenantId: string,
    invoiceId: string,
    jobId: string,
  ) => Promise<void>;
}

/**
 * Support invoices approved on Finans are sent at their send time (the 1st at 08:00), and failed
 * card charges are retried on their retry day. Job ids are per invoice and day.
 */
export async function invoiceTick(deps: InvoiceTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  const due = await deps.dueInvoiceJobs(now);
  const day = now.toISOString().slice(0, 10);
  for (const j of due)
    await deps.enqueue(j.job, j.tenantId, j.invoiceId, `${j.job}-${j.invoiceId}-${day}`);
  return due.length;
}

export const BILLING_INTERVAL_MS = 15 * 60_000;
