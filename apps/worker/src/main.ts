import { createQuickPay, quickPayMode } from '@agentor/billing';
import { createHash } from 'node:crypto';
import { loadKekFile, publicOf, publicKeyFromBase64 } from '@agentor/keybox';
import { createDatabase } from '@agentor/db';
import { flowsQueue, QUEUES, redisConnection } from '@agentor/jobs';
import { FlowProducer, Worker } from 'bullmq';
import pino from 'pino';
import { processBillingJob } from './billing.js';
import { processConnectionJob } from './connections.js';
import { processFlowJobByName } from './flows.js';
import { metrics, serveMetrics } from './metrics.js';

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
    QUICKPAY_PRIVATE_KEY: process.env.QUICKPAY_PRIVATE_KEY,
    APP_URL: appUrl,
    NODE_ENV: process.env.NODE_ENV,
  }),
  mode: quickPayMode(process.env.QUICKPAY_MODE),
  callbackUrl: new URL('/billing/quickpay', ingestUrl).toString(),
  log: log.child({ queue: QUEUES.billing }),
};

// The KEK private key is read once at start-up; the file is readable by agentor-worker only.
const kekPrivate = loadKekFile(required('KEK_FILE'));
const kekPublicB64 = publicOf(kekPrivate);
const connectionDeps = {
  db: database.db,
  kekPrivate,
  kekPublic: publicKeyFromBase64(kekPublicB64),
  kekId: createHash('sha256').update(kekPublicB64).digest('hex').slice(0, 16),
  connectorMode: (process.env.CONNECTOR_MODE === 'live' ? 'live' : 'mock') as 'mock' | 'live',
  log: log.child({ queue: QUEUES.connections }),
};

const producer = new FlowProducer({ connection });
const flowDeps = {
  ...connectionDeps,
  producer,
  redis: connection,
  flowQueue: flowsQueue(connection),
};
// Prometheus scrapes this on the server (localhost only); off unless METRICS_PORT is set.
const metricsServer = process.env.METRICS_PORT
  ? serveMetrics(metrics, Number(process.env.METRICS_PORT))
  : null;

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
  new Worker(QUEUES.flows, (job) => processFlowJobByName(flowDeps, job.name, job.data), {
    connection,
    concurrency: 4,
  }),
  new Worker(QUEUES.connections, (job) => processConnectionJob(flowDeps, job.name, job.data), {
    connection,
    concurrency: 4,
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
  await producer.close();
  metricsServer?.close();
  clearTimeout(timeout);
  await database.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
