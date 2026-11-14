import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, needsCustomer, nextRecordRetry } from '../src/engine.js';

const at = new Date('2026-10-19T10:00:00Z');
const minutes = (d: Date | null) => (d ? (d.getTime() - at.getTime()) / 60_000 : null);

describe('record retries', () => {
  it('backs off from 1 minute to 6 hours, then stops after 8 tries', () => {
    const plan = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      minutes(nextRecordRetry(at, n, 'transient', 0.5)),
    );
    expect(plan).toEqual([1, 5, 15, 60, 180, 360, 360, null]);
    expect(MAX_ATTEMPTS).toBe(8);
  });

  it('adds ±20 % jitter', () => {
    expect(minutes(nextRecordRetry(at, 4, 'transient', 0))).toBe(48);
    expect(minutes(nextRecordRetry(at, 4, 'transient', 1))).toBe(72);
  });

  it('never retries what the customer has to fix', () => {
    for (const f of ['invalid', 'mapping', 'dependency']) {
      expect(nextRecordRetry(at, 1, f, 0.5)).toBeNull();
      expect(needsCustomer(f)).toBe(true);
    }
    expect(needsCustomer('transient')).toBe(false);
  });

  it('waits at least as long as the system asks', () => {
    expect(minutes(nextRecordRetry(at, 1, 'rate_limited', 0.5, 10 * 60_000))).toBe(10);
  });
});
