import { createDatabase, dueSubscriptions } from '@agentor/db';
import { billingQueue, enqueueBilling } from '@agentor/jobs';
import { Redis } from 'ioredis';
import pino from 'pino';
import { BILLING_INTERVAL_MS, billingTick } from './billing.js';
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
    .catch((err: unknown) =>
      log.error({ err: err instanceof Error ? err.message : err }, 'billing tick failed'),
    );
const billingTimer = setInterval(runBilling, BILLING_INTERVAL_MS);
setTimeout(runBilling, 5_000);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  clearInterval(billingTimer);
  await lock.stop();
  await queue.close();
  await database.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
