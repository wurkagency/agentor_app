import { createQuickPay, quickPayMode } from '@agentor/billing';
import { createDatabase } from '@agentor/db';
import { QUEUES, redisConnection } from '@agentor/jobs';
import { Worker } from 'bullmq';
import pino from 'pino';
import { processBillingJob } from './billing.js';

/**
 * agentor-worker: the only process with the KEK and outbound access to customer systems
 * (produktspecifikation §10.1). Queue processors are registered as the sync engine is built.
 */
const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'agentor-worker' } });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const connection = redisConnection(required('REDIS_URL'));
const database = createDatabase(required('DATABASE_URL_WORKER'), {
  applicationName: 'agentor-worker',
});
const appUrl = required('APP_URL');
const ingestUrl = process.env.INGEST_PUBLIC_URL ?? 'http://127.0.0.1:3100';

const billingDeps = {
  db: database.db,
  quickpay: createQuickPay({
    QUICKPAY_MODE: process.env.QUICKPAY_MODE,
    QUICKPAY_API_KEY: process.env.QUICKPAY_API_KEY,
    APP_URL: appUrl,
    NODE_ENV: process.env.NODE_ENV,
  }),
  mode: quickPayMode(process.env.QUICKPAY_MODE),
  callbackUrl: new URL('/billing/quickpay', ingestUrl).toString(),
  log: log.child({ queue: QUEUES.billing }),
};

const workers = [
  new Worker(
    QUEUES.system,
    async (job) => {
      log.info({ jobId: job.id, name: job.name }, 'system job');
    },
    { connection, concurrency: 1 },
  ),
  new Worker(QUEUES.billing, (job) => processBillingJob(billingDeps, job.name, job.data), {
    connection,
    concurrency: 2,
  }),
];
for (const w of workers) {
  w.on('failed', (job, err) =>
    log.error({ queue: w.name, jobId: job?.id, name: job?.name, err: err.message }, 'job failed'),
  );
}
log.info({ queues: workers.map((w) => w.name), quickpay: billingDeps.mode }, 'worker started');

// Graceful deploy (§10.4): stop taking jobs, let active ones finish (max 60 s), then exit.
const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  const timeout = setTimeout(() => process.exit(1), 60_000);
  await Promise.all(workers.map((w) => w.close()));
  clearTimeout(timeout);
  await database.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
