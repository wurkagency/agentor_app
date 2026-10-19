import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * Queues on the dedicated Redis (produktspecifikation §10.1). Job payloads carry ids, never
 * secrets or customer data; anything sensitive is read by the worker from the database.
 */
export const QUEUES = {
  system: 'agentor-system',
  billing: 'agentor-billing',
} as const;

export const billingJobs = {
  /** A verified QuickPay callback; the raw body is re-parsed by the worker. */
  'quickpay.callback': z.object({ body: z.string().max(64 * 1024) }),
  /** Monthly charge for one tenant, enqueued by the scheduler. */
  'billing.charge': z.object({ tenantId: z.uuid() }),
} as const;

export type BillingJobName = keyof typeof billingJobs;
export type BillingJobData<N extends BillingJobName> = z.infer<(typeof billingJobs)[N]>;

/** BullMQ needs maxRetriesPerRequest: null on blocking connections. */
export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function billingQueue(connection: Redis): Queue {
  return new Queue(QUEUES.billing, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

/** Validates the payload before it reaches Redis, so a bad producer fails at the call site. */
export async function enqueueBilling<N extends BillingJobName>(
  queue: Queue,
  name: N,
  data: BillingJobData<N>,
  opts: { jobId?: string } = {},
): Promise<void> {
  const parsed = billingJobs[name].parse(data);
  await queue.add(name, parsed, opts.jobId ? { jobId: opts.jobId } : {});
}

export function parseBillingJob<N extends BillingJobName>(
  name: N,
  data: unknown,
): BillingJobData<N> {
  return billingJobs[name].parse(data) as BillingJobData<N>;
}

export function isBillingJob(name: string): name is BillingJobName {
  return Object.hasOwn(billingJobs, name);
}
