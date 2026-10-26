import { copenhagenClock, lastWeekKey } from '@agentor/core';

/**
 * E22 "Ugentlig opsummering" (PLAN-EMAILS-PDF §5): on Monday from 08:00 Copenhagen time the
 * leader queues last week's summary for everyone who switched it on. The queue key is the week,
 * so ticks that run again the same morning (or on a second scheduler) queue nothing new; the
 * worker builds and sends each e-mail.
 */
export interface WeeklyTickDeps {
  isLeader: () => boolean;
  recipients: () => Promise<{ tenantId: string; userId: string }[]>;
  /** Queues one e-mail; false when that week was already queued for the person. */
  queue: (tenantId: string, userId: string, key: string) => Promise<boolean>;
}

export async function weeklyTick(deps: WeeklyTickDeps, now = new Date()): Promise<number> {
  if (!deps.isLeader()) return 0;
  const clock = copenhagenClock(now);
  // Monday 08:00–11:59: a scheduler that was down at 08:00 still sends the same morning.
  if (clock.weekday !== 1 || clock.hour < 8 || clock.hour >= 12) return 0;
  const key = lastWeekKey(now);
  let queued = 0;
  for (const r of await deps.recipients())
    if (await deps.queue(r.tenantId, r.userId, key)) queued++;
  return queued;
}

export const WEEKLY_INTERVAL_MS = 5 * 60_000;
