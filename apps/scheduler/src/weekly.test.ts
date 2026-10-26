import { describe, expect, it } from 'vitest';
import { weeklyTick } from './weekly.js';

function deps(leader = true) {
  const queued = new Set<string>();
  return {
    queued,
    d: {
      isLeader: () => leader,
      recipients: async () => [
        { tenantId: 't1', userId: 'u1' },
        { tenantId: 't1', userId: 'u2' },
      ],
      queue: async (tenantId: string, userId: string, key: string) => {
        const k = `${tenantId}:${userId}:${key}`;
        if (queued.has(k)) return false;
        queued.add(k);
        return true;
      },
    },
  };
}

describe('weekly summary tick (E22)', () => {
  it('queues last week for everyone opted in on Monday at 08:00 Copenhagen time', async () => {
    const { d, queued } = deps();
    // Monday 19 Oct 2026 08:00 CEST = 06:00 UTC.
    expect(await weeklyTick(d, new Date('2026-10-19T06:00:00Z'))).toBe(2);
    expect([...queued]).toEqual(['t1:u1:week:2026-W42', 't1:u2:week:2026-W42']);
  });

  it('is idempotent within the morning', async () => {
    const { d } = deps();
    await weeklyTick(d, new Date('2026-10-19T06:00:00Z'));
    expect(await weeklyTick(d, new Date('2026-10-19T06:05:00Z'))).toBe(0);
  });

  it('does nothing before 08:00, on other days, or when not the leader', async () => {
    expect(await weeklyTick(deps().d, new Date('2026-10-19T05:59:00Z'))).toBe(0);
    expect(await weeklyTick(deps().d, new Date('2026-10-20T06:00:00Z'))).toBe(0);
    expect(await weeklyTick(deps(false).d, new Date('2026-10-19T06:00:00Z'))).toBe(0);
  });

  it('uses Copenhagen time in winter (CET)', async () => {
    const { d, queued } = deps();
    // Monday 4 Jan 2027 08:00 CET = 07:00 UTC; last week is 2026-W53.
    expect(await weeklyTick(d, new Date('2027-01-04T06:59:00Z'))).toBe(0);
    expect(await weeklyTick(d, new Date('2027-01-04T07:00:00Z'))).toBe(2);
    expect([...queued][0]).toBe('t1:u1:week:2026-W53');
  });
});
