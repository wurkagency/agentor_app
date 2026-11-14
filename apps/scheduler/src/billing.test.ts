import { describe, expect, it, vi } from 'vitest';
import { billingTick, invoiceTick } from './billing.js';

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

describe('invoiceTick', () => {
  const now = new Date('2026-11-01T07:15:00Z');

  it('enqueues sends and retries with a per-invoice, per-day job id', async () => {
    const enqueue = vi.fn(async () => {});
    const n = await invoiceTick(
      {
        isLeader: () => true,
        dueInvoiceJobs: async () => [
          { tenantId: 't1', invoiceId: 'i1', job: 'send' as const },
          { tenantId: 't2', invoiceId: 'i2', job: 'retry' as const },
        ],
        enqueue,
      },
      now,
    );
    expect(n).toBe(2);
    expect(enqueue).toHaveBeenCalledWith('send', 't1', 'i1', 'send-i1-2026-11-01');
    expect(enqueue).toHaveBeenCalledWith('retry', 't2', 'i2', 'retry-i2-2026-11-01');
  });

  it('does nothing unless it is the leader', async () => {
    const due = vi.fn(async () => []);
    expect(
      await invoiceTick({ isLeader: () => false, dueInvoiceJobs: due, enqueue: vi.fn() }, now),
    ).toBe(0);
    expect(due).not.toHaveBeenCalled();
  });
});
