import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Real Redis (docker compose locally, service container in CI); env() needs these to exist.
process.env.REDIS_URL ??= 'redis://127.0.0.1:56379';
process.env.DATABASE_URL_WEB ??= 'postgres://unused';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-123';

const { redis } = await import('../infra');
const { clearFailures, isLocked, MAX_FAILURES, recordFailure } = await import('./lockout');
const { redisRateLimitStorage } = await import('./rate-limit');
const { describeAgent } = await import('./new-device');

const email = `lockout-${process.pid}@example.test`;

beforeEach(async () => {
  await clearFailures(email);
});
afterAll(async () => {
  await clearFailures(email);
  redis().disconnect();
});

describe('account lockout', () => {
  it('locks after the maximum number of failures and unlocks when cleared', async () => {
    for (let i = 1; i < MAX_FAILURES; i++) await recordFailure(email);
    expect(await isLocked(email)).toBe(false);
    await recordFailure(email);
    expect(await isLocked(email)).toBe(true);
    await clearFailures(email);
    expect(await isLocked(email)).toBe(false);
  });

  it('stores a hash, never the e-mail address', async () => {
    await recordFailure(email);
    const keys = await redis().keys('agentor:lockout:*');
    expect(keys.some((k) => k.includes('@'))).toBe(false);
  });
});

describe('rate-limit storage', () => {
  it('allows up to max requests per window, then reports retryAfter', async () => {
    const key = `test-${process.pid}-${Date.now()}`;
    const rule = { window: 60, max: 3 };
    for (let i = 0; i < 3; i++)
      expect((await redisRateLimitStorage.consume(key, rule)).allowed).toBe(true);
    const blocked = await redisRateLimitStorage.consume(key, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    await redis().del(`agentor:rl:${key}`);
  });

  it('is atomic under concurrent requests', async () => {
    const key = `test-concurrent-${process.pid}-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => redisRateLimitStorage.consume(key, { window: 60, max: 5 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    await redis().del(`agentor:rl:${key}`);
  });
});

describe('new-device description', () => {
  it('describes a browser and OS without the raw user agent', () => {
    expect(
      describeAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome på Windows');
    expect(
      describeAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1',
      ),
    ).toBe('Safari på iOS');
  });
});

vi.restoreAllMocks();
