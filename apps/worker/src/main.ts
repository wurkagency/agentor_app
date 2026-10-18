import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

/**
 * agentor-worker: the only process with the KEK and outbound access to customer systems
 * (produktspecifikation §10.1). Queue processors are registered as the sync engine is built.
 */
const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'agentor-worker' } });
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required');

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const workers = [
  new Worker(
    'agentor-system',
    async (job) => {
      log.info({ jobId: job.id, name: job.name }, 'system job');
    },
    { connection, concurrency: 1 },
  ),
];
log.info({ queues: workers.map((w) => w.name) }, 'worker started');

// Graceful deploy (§10.4): stop taking jobs, let active ones finish (max 60 s), then exit.
const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  const timeout = setTimeout(() => process.exit(1), 60_000);
  await Promise.all(workers.map((w) => w.close()));
  clearTimeout(timeout);
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
