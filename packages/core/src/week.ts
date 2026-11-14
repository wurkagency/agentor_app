/**
 * Weeks for the weekly summary (E22): ISO 8601 weeks in Copenhagen time. The scheduler queues
 * "week:2026-W42" on Monday 08:00; the worker turns the key back into the week's start and end.
 */

/** ISO week of a UTC calendar day: the week belongs to the year of its Thursday. */
export function isoWeek(day: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return {
    year: t.getUTCFullYear(),
    week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7),
  };
}

/** Wall clock in Copenhagen: weekday (1 = Monday … 7 = Sunday), hour and calendar date. */
export function copenhagenClock(d: Date): { weekday: number; hour: number; date: Date } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return {
    weekday,
    hour: Number(get('hour')),
    date: new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')))),
  };
}

/** Midnight in Copenhagen at the start of the given UTC calendar day. */
export function copenhagenMidnight(dayUtc: Date): Date {
  const guess = new Date(
    Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate()),
  );
  // Copenhagen is UTC+1 or UTC+2, so local midnight is 23:00 or 22:00 UTC the day before.
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Copenhagen',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(guess)
      .find((p) => p.type === 'hour')?.value ?? 0,
  );
  return new Date(guess.getTime() - hour * 3_600_000);
}

/** The key of the week before `now` in Copenhagen: "week:2026-W42". */
export function lastWeekKey(now: Date): string {
  const today = copenhagenClock(now).date;
  const { year, week } = isoWeek(new Date(today.getTime() - 7 * 86_400_000));
  return `week:${year}-W${String(week).padStart(2, '0')}`;
}

/** "week:2026-W42" → week 42: Monday 00:00 to the next Monday 00:00, Copenhagen time. */
export function weekFromKey(key: string): { number: number; from: Date; to: Date } | null {
  const m = /^week:(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // ISO week 1 is the week with 4 January in it.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  const start = new Date(monday.getTime() + (week - 1) * 7 * 86_400_000);
  return {
    number: week,
    from: copenhagenMidnight(start),
    to: copenhagenMidnight(new Date(start.getTime() + 7 * 86_400_000)),
  };
}
