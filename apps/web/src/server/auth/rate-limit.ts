import { redis } from '../infra';

// Fixed window counter, atomic in Redis: INCR, set the window on the first hit, report TTL.
const CONSUME = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { n, ttl }
`;

/** Rate-limit storage for Better Auth, shared by all web processes (produktspecifikation §9.5). */
export const redisRateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }) {
    const [count, ttl] = (await redis().eval(CONSUME, 1, `agentor:rl:${key}`, rule.window)) as [
      number,
      number,
    ];
    if (count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: Math.max(1, ttl) };
  },
};
