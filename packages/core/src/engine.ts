/**
 * Sync engine rules (produktspecifikation §4.1). Pure, so the worker, the scheduler and the
 * tests agree on them.
 */

/** Polls read again from the cursor minus this overlap; the idempotency key drops repeats. */
export const POLL_OVERLAP_MS = 2 * 60_000;
/** A failed record is tried at most this many times automatically. */
export const MAX_ATTEMPTS = 8;
/** Backoff before try 2, 3, … 8: 1 min growing to 6 h. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 360] as const;
/** Wait at least this long when a system says "too many requests" without saying how long. */
export const RATE_LIMIT_FALLBACK_MS = 60_000;

/**
 * When a record that failed on its `attempts`-th try is tried again, or null when it isn't:
 * after the last try, or when the failure needs the customer (invalid data, mapping, missing
 * dependency). `random` is 0–1 for ±20 % jitter so retries don't arrive together.
 */
export function nextRecordRetry(
  failedAt: Date,
  attempts: number,
  failure: string | null | undefined,
  random: number,
  retryAfterMs?: number,
): Date | null {
  if (failure === 'invalid' || failure === 'mapping' || failure === 'dependency') return null;
  if (attempts >= MAX_ATTEMPTS) return null;
  const base = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1]! * 60_000;
  const jitter = 1 + (Math.min(Math.max(random, 0), 1) * 0.4 - 0.2);
  const delay = Math.max(base * jitter, retryAfterMs ?? 0);
  return new Date(failedAt.getTime() + Math.round(delay));
}

/** Failures the customer has to fix ("Kræver handling"); everything else is retried first. */
export function needsCustomer(failure: string | null | undefined): boolean {
  return failure === 'invalid' || failure === 'mapping' || failure === 'dependency';
}
