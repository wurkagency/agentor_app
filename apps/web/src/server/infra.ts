import { createDatabase, type DatabaseHandle } from '@agentor/db';
import { Redis } from 'ioredis';
import { env } from './env';

/**
 * Process-wide singletons. Kept on globalThis so Next's dev hot reload doesn't open a new pool
 * on every edit.
 */
const g = globalThis as unknown as { __agentorDb?: DatabaseHandle; __agentorRedis?: Redis };

export function database(): DatabaseHandle {
  g.__agentorDb ??= createDatabase(env().DATABASE_URL_WEB, {
    max: 10,
    applicationName: 'agentor-app',
  });
  return g.__agentorDb;
}

export function db() {
  return database().db;
}

export function redis(): Redis {
  g.__agentorRedis ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  return g.__agentorRedis;
}
