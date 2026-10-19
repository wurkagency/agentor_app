import { describe, expect, it, vi } from 'vitest';
import { billingTick } from './billing.js';

describe('billingTick', () => {
  const now = new Date('2026-11-01T06:00:00Z');

  it('enqueues one charge per due tenant with a per-day job id', async () => {
    const enqueueCharge = vi.fn(async () => {});
    const n = await billingTick(
      { isLeader: () => true, dueSubscriptions: async () => ['t1', 't2'], enqueueCharge },
      now,
    );
    expect(n).toBe(2);
    expect(enqueueCharge).toHaveBeenCalledWith('t1', 'charge-t1-2026-11-01');
    expect(enqueueCharge).toHaveBeenCalledWith('t2', 'charge-t2-2026-11-01');
  });

  it('does nothing unless it is the leader', async () => {
    const due = vi.fn(async () => ['t1']);
    const n = await billingTick(
      { isLeader: () => false, dueSubscriptions: due, enqueueCharge: vi.fn() },
      now,
    );
    expect(n).toBe(0);
    expect(due).not.toHaveBeenCalled();
  });
});
