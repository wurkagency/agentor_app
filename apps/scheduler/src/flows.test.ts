import { describe, expect, it, vi } from 'vitest';
import { flowTick } from './flows.js';

describe('flowTick', () => {
  it('creates and queues one run per due flow, skipping flows that no longer qualify', async () => {
    const enqueue = vi.fn(async () => {});
    const n = await flowTick({
      isLeader: () => true,
      dueFlows: async () => [
        { tenantId: 't1', flowId: 'f1' },
        { tenantId: 't1', flowId: 'f2' },
      ],
      createRun: async (_t, f) => (f === 'f1' ? 'r1' : null),
      enqueue,
    });
    expect(n).toBe(1);
    expect(enqueue).toHaveBeenCalledWith('t1', 'r1');
  });

  it('does nothing unless leader', async () => {
    const due = vi.fn(async () => []);
    await flowTick({ isLeader: () => false, dueFlows: due, createRun: vi.fn(), enqueue: vi.fn() });
    expect(due).not.toHaveBeenCalled();
  });
});
