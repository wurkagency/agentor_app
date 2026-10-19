import { billingQueue, enqueueBilling, redisConnection } from '@agentor/jobs';
import { buildApp } from './app.js';

const port = Number(process.env.INGEST_PORT ?? 3100);
const host = process.env.INGEST_HOST ?? '127.0.0.1';

const redisUrl = process.env.REDIS_URL;
const queue = redisUrl ? billingQueue(redisConnection(redisUrl)) : null;

const app = buildApp({
  quickpayPrivateKey: process.env.QUICKPAY_PRIVATE_KEY,
  enqueueQuickPay: queue
    ? (body, jobId) => enqueueBilling(queue, 'quickpay.callback', { body }, { jobId })
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
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host });
