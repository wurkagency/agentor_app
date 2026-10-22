import { createHash } from 'node:crypto';
import { redis } from '../infra';

/**
 * Account lockout after repeated failed password sign-ins (produktspecifikation §9.5).
 * Complements the per-IP rate limit: 10 failures within 15 minutes lock the e-mail for
 * 15 minutes, whatever IP the attempts come from. Keys hold a hash, not the address.
 */
export const MAX_FAILURES = 10;
export const WINDOW_SECONDS = 15 * 60;

const key = (email: string) =>
  `agentor:lockout:${createHash('sha256').update(email).digest('hex')}`;

export async function isLocked(email: string): Promise<boolean> {
  const n = Number((await redis().get(key(email))) ?? 0);
  return n >= MAX_FAILURES;
}

export async function recordFailure(email: string): Promise<number> {
  const k = key(email);
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, WINDOW_SECONDS);
  return n;
}

export async function clearFailures(email: string): Promise<void> {
  await redis().del(key(email));
}
