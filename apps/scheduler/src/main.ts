import {
  createDatabase,
  createEngineRun,
  createScheduledRun,
  dueFlows,
  dueInvoiceJobs,
  dueSubscriptions,
  failStaleRuns,
  retentionSweep,
} from '@agentor/db';
import { billingQueue, enqueueBilling, enqueueFlowRun, flowsQueue } from '@agentor/jobs';
import { Redis } from 'ioredis';
import pino from 'pino';
import { BILLING_INTERVAL_MS, billingTick, invoiceTick } from './billing.js';
import {
  FLOW_INTERVAL_MS,
  flowTick,
  HOUSEKEEPING_INTERVAL_MS,
  RETENTION_INTERVAL_MS,
  STALE_RUN_MS,
} from './flows.js';
import { LeaderLock } from './leader-lock.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'agentor-scheduler' },
});
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required');

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

// Scheduled duties (polling, token refresh, retention, quota reset, QuickPay billing) are
// registered here as they are built; only the leader runs them.
const lock = new LeaderLock(redis, {
  onAcquired: () => log.info('became leader'),
  onLost: () => log.warn('lost leadership'),
});
lock.start();

const dbUrl = process.env.DATABASE_URL_WORKER;
if (!dbUrl) throw new Error('DATABASE_URL_WORKER is required');
const database = createDatabase(dbUrl, { max: 2, applicationName: 'agentor-scheduler' });
const queue = billingQueue(redis);

const runBilling = () =>
  billingTick({
    isLeader: () => lock.isLeader,
    dueSubscriptions: (now) => dueSubscriptions(database.db, now),
    enqueueCharge: (tenantId, jobId) =>
      enqueueBilling(queue, 'billing.charge', { tenantId }, { jobId }),
  })
    .then((n) => n && log.info({ due: n }, 'billing charges enqueued'))
    .then(() =>
      invoiceTick({
        isLeader: () => lock.isLeader,
        dueInvoiceJobs: (now) => dueInvoiceJobs(database.db, now),
        enqueue: (job, tenantId, invoiceId, jobId) =>
          job === 'send'
            ? enqueueBilling(queue, 'billing.send-invoice', { tenantId, invoiceId }, { jobId })
            : enqueueBilling(queue, 'billing.retry', { tenantId, invoiceId }, { jobId }),
      }),
    )
    .then((n) => n && log.info({ due: n }, 'invoice jobs enqueued'))
    // Unfinished signups (24 h, PLAN-SIGNUP B1): one job per tick, the worker does the rest.
    .then(() =>
      lock.isLeader
        ? enqueueBilling(
            queue,
            'signup.purge',
            {},
            { jobId: `signup-purge-${Math.floor(Date.now() / BILLING_INTERVAL_MS)}` },
          )
        : undefined,
    )
    .catch((err: unknown) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'billing tick failed'),
    );
const billingTimer = setInterval(runBilling, BILLING_INTERVAL_MS);
setTimeout(runBilling, 5_000);

const runQueue = flowsQueue(redis);
const runFlows = () =>
  flowTick({
    isLeader: () => lock.isLeader,
    dueFlows: (now) => dueFlows(database.db, now),
    createRun: (tenantId, flowId, kind) =>
      kind === 'retry'
        ? createEngineRun(database.db, tenantId, flowId, 'retry')
        : createScheduledRun(database.db, tenantId, flowId),
    enqueue: (tenantId, runId) => enqueueFlowRun(runQueue, { tenantId, runId }),
  })
    .then((n) => n && log.info({ runs: n }, 'flow runs queued'))
    .catch((err: unknown) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'flow tick failed'),
    );
const flowTimer = setInterval(runFlows, FLOW_INTERVAL_MS);

// Housekeeping on the leader: runs a dead worker left behind, and retention once a day.
const runStale = () =>
  lock.isLeader
    ? failStaleRuns(database.db, new Date(Date.now() - STALE_RUN_MS))
        .then((n) => n && log.warn({ runs: n }, 'stale runs failed'))
        .catch((err: unknown) =>
          log.error({ err: err instanceof Error ? err.message : err }, 'stale sweep failed'),
        )
    : undefined;
const runRetention = () =>
  lock.isLeader
    ? retentionSweep(database.db)
        .then((r) => log.info(r, 'retention sweep'))
        .catch((err: unknown) =>
          log.error({ err: err instanceof Error ? err.message : err }, 'retention sweep failed'),
        )
    : undefined;
const staleTimer = setInterval(runStale, HOUSEKEEPING_INTERVAL_MS);
const retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
setTimeout(runRetention, 60_000);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  clearInterval(billingTimer);
  clearInterval(flowTimer);
  clearInterval(staleTimer);
  clearInterval(retentionTimer);
  await runQueue.close();
  await lock.stop();
  await queue.close();
  await database.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
