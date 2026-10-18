import { Redis } from 'ioredis';
import pino from 'pino';
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

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  await lock.stop();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
