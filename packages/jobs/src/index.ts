import { Queue, type FlowProducer, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * Queues on the dedicated Redis (produktspecifikation §10.1). Job payloads carry ids, never
 * secrets or customer data; anything sensitive is read by the worker from the database.
 */
export const QUEUES = {
  system: 'agentor-system',
  billing: 'agentor-billing',
  connections: 'agentor-connections',
  flows: 'agentor-flows',
} as const;

export const billingJobs = {
  /** A verified QuickPay callback; the raw body is re-parsed by the worker. */
  'quickpay.callback': z.object({ body: z.string().max(64 * 1024) }),
  /** Monthly charge for one tenant, enqueued by the scheduler. */
  'billing.charge': z.object({ tenantId: z.uuid() }),
  /** An approved support invoice to number and send or charge (Finans, F5). */
  'billing.send-invoice': z.object({ tenantId: z.uuid(), invoiceId: z.uuid() }),
  /** A failed card charge due for its next try (2, 5 and 9 days). */
  'billing.retry': z.object({ tenantId: z.uuid(), invoiceId: z.uuid() }),
  /** Unfinished signups older than 24 hours are deleted (PLAN-SIGNUP B1). */
  'signup.purge': z.object({}),
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

/* ---- Connections and webhooks (M5) -------------------------------------------------------------- */

export const connectionJobs = {
  /** Open sealed credentials, move them under the tenant DEK and test the connection. */
  'connection.test': z.object({ tenantId: z.uuid(), connectionId: z.uuid() }),
  /** A stored inbound webhook to verify; the body stays in the database. */
  'webhook.received': z.object({ tenantId: z.uuid(), eventId: z.uuid() }),
  /**
   * A new webhook address (Ny webhook-adresse): the worker puts it in the credentials, which
   * the web can't read, and registers it in the system again (PLAN-INTEGRATIONS §4.5).
   */
  'connection.webhook': z.object({
    tenantId: z.uuid(),
    connectionId: z.uuid(),
    webhookUrl: z.url().max(300),
  }),
} as const;

export type ConnectionJobName = keyof typeof connectionJobs;
export type ConnectionJobData<N extends ConnectionJobName> = z.infer<(typeof connectionJobs)[N]>;

export function connectionsQueue(connection: Redis): Queue {
  return new Queue(QUEUES.connections, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

export async function enqueueConnectionJob<N extends ConnectionJobName>(
  queue: Queue,
  name: N,
  data: ConnectionJobData<N>,
  opts: { jobId?: string } = {},
): Promise<void> {
  const parsed = connectionJobs[name].parse(data);
  await queue.add(name, parsed, opts.jobId ? { jobId: opts.jobId } : {});
}

export function parseConnectionJob<N extends ConnectionJobName>(
  name: N,
  data: unknown,
): ConnectionJobData<N> {
  return connectionJobs[name].parse(data) as ConnectionJobData<N>;
}

/* ---- Flow runs (M6) -------------------------------------------------------------------------------- */

export const flowJobs = {
  /** Execute a queued run (scheduled, manual, retry or test). */
  'flow.run': z.object({
    tenantId: z.uuid(),
    runId: z.uuid(),
    /** Retry: only open failures (optionally on one route). */
    retry: z.object({ routeId: z.string().max(40).optional() }).optional(),
  }),
  /** One route of a run (fan-out): the records are read from the run's stored payloads. */
  'flow.route': z.object({ tenantId: z.uuid(), runId: z.uuid(), routeId: z.string().max(40) }),
  /** Runs when every route job of a run is done: totals, status and notifications. */
  'flow.finish': z.object({ tenantId: z.uuid(), runId: z.uuid() }),
  /**
   * Live preview of a developer expression against a fictional sample record. The web never
   * evaluates expressions itself; the worker runs them in the same sandbox as the engine.
   */
  'expression.preview': z.object({
    entity: z.enum(['order', 'creditNote', 'customer', 'product', 'stock']),
    source: z.string().max(2000),
  }),
} as const;

export type FlowJobName = keyof typeof flowJobs;
export type FlowJobData = z.infer<(typeof flowJobs)['flow.run']>;

export function parseFlowJobOf<N extends FlowJobName>(
  name: N,
  data: unknown,
): z.infer<(typeof flowJobs)[N]> {
  return flowJobs[name].parse(data) as z.infer<(typeof flowJobs)[N]>;
}

/**
 * Fans a run out to one job per route, with a finishing job that runs when they are all done
 * (BullMQ flow). Job ids are derived from the run, so a repeated fan-out adds nothing.
 */
export async function enqueueRouteJobs(
  producer: FlowProducer,
  data: { tenantId: string; runId: string; routeIds: string[] },
): Promise<void> {
  await producer.add({
    name: 'flow.finish',
    queueName: QUEUES.flows,
    data: flowJobs['flow.finish'].parse({ tenantId: data.tenantId, runId: data.runId }),
    opts: { jobId: `finish-${data.runId}`, ...FLOW_JOB_OPTIONS },
    children: data.routeIds.map((routeId) => ({
      name: 'flow.route',
      queueName: QUEUES.flows,
      data: flowJobs['flow.route'].parse({ tenantId: data.tenantId, runId: data.runId, routeId }),
      opts: { jobId: `route-${data.runId}-${routeId}`, ...FLOW_JOB_OPTIONS },
    })),
  });
}

const FLOW_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
} as const;

/* ---- Rate limits: token buckets in Redis (produktspecifikation §4.1) ---------------------------- */

const TAKE = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = capacity / 60000
local now = tonumber(ARGV[2])
local b = redis.call('HMGET', key, 'tokens', 'at')
local tokens = tonumber(b[1]) or capacity
local at = tonumber(b[2]) or now
tokens = math.min(capacity, tokens + (now - at) * refill_per_ms)
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = math.ceil((1 - tokens) / refill_per_ms)
end
redis.call('HSET', key, 'tokens', tokens, 'at', now)
redis.call('PEXPIRE', key, 120000)
return wait
`;

/**
 * Takes one token from a per-minute bucket; returns 0, or how many ms to wait before trying
 * again. Buckets are per destination connection and per tenant, shared by every worker.
 */
export async function takeToken(redis: Redis, key: string, perMinute: number): Promise<number> {
  const wait = await redis.eval(
    TAKE,
    1,
    `agentor:tb:${key}`,
    String(perMinute),
    String(Date.now()),
  );
  return Number(wait);
}

export function flowsQueue(connection: Redis): Queue {
  return new Queue(QUEUES.flows, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 3 },
  });
}

export async function enqueueFlowRun(queue: Queue, data: FlowJobData): Promise<void> {
  await queue.add('flow.run', flowJobs['flow.run'].parse(data), { jobId: data.runId });
}

export function parseFlowJob(data: unknown): FlowJobData {
  return flowJobs['flow.run'].parse(data);
}
