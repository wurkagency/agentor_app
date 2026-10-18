import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeaderLock } from './leader-lock.js';

// Integration test against the dedicated Redis (docker compose locally, service container in CI).
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
let redis: Redis;
const key = `agentor:test:leader:${process.pid}`;

beforeAll(async () => {
  redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
});
afterAll(async () => {
  await redis.del(key);
  redis.disconnect();
});

describe('LeaderLock', () => {
  it('lets exactly one instance lead', async () => {
    const a = new LeaderLock(redis, { key, ttlMs: 1000 });
    const b = new LeaderLock(redis, { key, ttlMs: 1000 });
    expect(await a.tick()).toBe(true);
    expect(await b.tick()).toBe(false);
    expect(await a.tick()).toBe(true); // renewal keeps it
    await a.stop();
    expect(await b.tick()).toBe(true); // released: b takes over
    await b.stop();
  });

  it('fails over when the leader stops renewing', async () => {
    const lost: string[] = [];
    const a = new LeaderLock(redis, { key, ttlMs: 200, onLost: () => lost.push('a') });
    const b = new LeaderLock(redis, { key, ttlMs: 200 });
    expect(await a.tick()).toBe(true);
    await new Promise((r) => setTimeout(r, 300)); // a "crashed": no renewals
    expect(await b.tick()).toBe(true);
    expect(await a.tick()).toBe(false); // a notices it lost the lock
    expect(lost).toEqual(['a']);
    await b.stop();
  });

  it('never releases a lock held by someone else', async () => {
    const a = new LeaderLock(redis, { key, ttlMs: 1000 });
    const b = new LeaderLock(redis, { key, ttlMs: 1000 });
    expect(await a.tick()).toBe(true);
    await b.stop();
    expect(await redis.get(key)).toBe(a.token);
    await a.stop();
  });
});
