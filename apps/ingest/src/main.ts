import { buildApp } from './app.js';

const port = Number(process.env.INGEST_PORT ?? 3100);
const host = process.env.INGEST_HOST ?? '127.0.0.1';

const app = buildApp({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'agentor-ingest' },
    // Never log credentials or payloads (produktspecifikation §9.6).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-wc-webhook-signature"]',
        'req.body',
      ],
      censor: '[masked]',
    },
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host });
