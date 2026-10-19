import { createDatabase, ingestWebhook } from '@agentor/db';
import {
  billingQueue,
  connectionsQueue,
  enqueueBilling,
  enqueueConnectionJob,
  redisConnection,
} from '@agentor/jobs';
import { buildApp } from './app.js';

const port = Number(process.env.INGEST_PORT ?? 3100);
const host = process.env.INGEST_HOST ?? '127.0.0.1';

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? redisConnection(redisUrl) : null;
const queue = redis ? billingQueue(redis) : null;
const hooksQueue = redis ? connectionsQueue(redis) : null;
// Runs as the web database role; it can only call app.ingest_webhook() for unknown tenants.
const database = process.env.DATABASE_URL_WEB
  ? createDatabase(process.env.DATABASE_URL_WEB, { max: 4, applicationName: 'agentor-ingest' })
  : null;

const app = buildApp({
  quickpayPrivateKey: process.env.QUICKPAY_PRIVATE_KEY,
  enqueueQuickPay: queue
    ? (body, jobId) => enqueueBilling(queue, 'quickpay.callback', { body }, { jobId })
    : undefined,
  storeWebhook: database
    ? (token, headers, body) => ingestWebhook(database.db, token, headers, body)
    : undefined,
  enqueueWebhook: hooksQueue
    ? (tenantId, eventId) =>
        enqueueConnectionJob(
          hooksQueue,
          'webhook.received',
          { tenantId, eventId },
          { jobId: eventId },
        )
    : undefined,
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'agentor-ingest' },
    // Never log credentials or payloads (produktspecifikation §9.6).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-wc-webhook-signature"]',
        'req.headers["quickpay-checksum-sha256"]',
        'req.body',
      ],
      censor: '[masked]',
    },
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await queue?.close();
  await hooksQueue?.close();
  await database?.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host });
