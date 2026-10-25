import { describe, expect, it } from 'vitest';
import { CONNECTION_MAX_AGE_MS, connectionTick } from './connections.js';

describe('connection health tick', () => {
  it('queues one health test per due connection, only on the leader', async () => {
    const queued: string[] = [];
    let asked: Date | null = null;
    const now = new Date('2026-10-25T12:00:00Z');
    const deps = {
      isLeader: () => true,
      due: async (before: Date) => {
        asked = before;
        return [{ tenantId: 't1', connectionId: 'c1' }];
      },
      enqueue: async (_t: string, _c: string, jobId: string) => void queued.push(jobId),
    };
    expect(await connectionTick(deps, now)).toBe(1);
    expect(asked!.getTime()).toBe(now.getTime() - CONNECTION_MAX_AGE_MS);
    expect(queued).toEqual([`health-c1-${Math.floor(now.getTime() / (15 * 60_000))}`]);
    expect(await connectionTick({ ...deps, isLeader: () => false }, now)).toBe(0);
  });
});
