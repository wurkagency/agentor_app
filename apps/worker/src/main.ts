import { createQuickPay, quickPayMode } from '@agentor/billing';
import { createHash } from 'node:crypto';
import { loadKekFile, publicOf, publicKeyFromBase64 } from '@agentor/keybox';
import { createDatabase } from '@agentor/db';
import { createMailer } from '@agentor/email';
import { flowsQueue, QUEUES, redisConnection } from '@agentor/jobs';
import { FlowProducer, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { processBillingJob } from './billing.js';
import { processConnectionJob } from './connections.js';
import { processFlowJobByName } from './flows.js';
import { metrics, serveMetrics } from './metrics.js';
import { drainEmailQueue } from './email.js';
import { drainPushQueue } from './push.js';

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
  // Visma Connect client for Dinero token refresh (PLAN §5.1); the same app as the web login.
  oauth:
    process.env.DINERO_CLIENT_ID && process.env.DINERO_CLIENT_SECRET
      ? {
          dinero: {
            clientId: process.env.DINERO_CLIENT_ID,
            clientSecret: process.env.DINERO_CLIENT_SECRET,
          },
        }
      : {},
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

// Web Push (PLAN-MOBILE M3): off until the VAPID key pair is configured.
const vapid =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? {
        publicKey: process.env.VAPID_PUBLIC_KEY,
        privateKey: process.env.VAPID_PRIVATE_KEY,
        subject: process.env.VAPID_SUBJECT ?? 'mailto:support@agentor.dk',
      }
    : null;
const pushDeps = { db: database.db, redis: connection, log: log.child({ part: 'push' }), vapid };
const pushTimer = vapid
  ? setInterval(() => {
      drainPushQueue(pushDeps).catch((e: unknown) =>
        log.error({ err: e instanceof Error ? e.message : String(e) }, 'push drain failed'),
      );
    }, 5_000)
  : null;

// Notification e-mails E19–E22 (PLAN-EMAILS-PDF §5): Mailpit locally, Brevo SMTP in production.
const smtpUrl = process.env.SMTP_URL;
if (!smtpUrl && process.env.NODE_ENV === 'production')
  throw new Error('SMTP_URL is required: notification e-mails cannot be sent');
const emailLog = log.child({ part: 'email' });
const emailDeps = {
  db: database.db,
  redis: connection,
  log: emailLog,
  appUrl,
  send: createMailer({
    transport: nodemailer.createTransport(smtpUrl ?? 'smtp://127.0.0.1:51025'),
    from: process.env.MAIL_FROM ?? 'Agentor <no-reply@agentor.dk>',
    appUrl,
    log: emailLog,
  }),
};
const emailTimer = setInterval(() => {
  drainEmailQueue(emailDeps).catch((e: unknown) =>
    log.error({ err: e instanceof Error ? e.message : String(e) }, 'email drain failed'),
  );
}, 5_000);

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
log.info(
  { queues: workers.map((w) => w.name), quickpay: billingDeps.mode, push: Boolean(vapid) },
  'worker started',
);

// Graceful deploy (§10.4): stop taking jobs, let active ones finish (max 60 s), then exit.
const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  const timeout = setTimeout(() => process.exit(1), 60_000);
  if (pushTimer) clearInterval(pushTimer);
  clearInterval(emailTimer);
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
