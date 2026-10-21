import { describe, expect, it } from 'vitest';
import { addDaysIso, copenhagenToday, monthOf, parseDateRange } from './date-range';

describe('parseDateRange', () => {
  it('takes whole Copenhagen days, both ends inclusive', () => {
    const r = parseDateRange('2026-10-01', '2026-10-15', 90)!;
    expect(r.days).toBe(15);
    // 1 Oct 2026 00:00 in Copenhagen is 30 Sep 22:00 UTC (summer time).
    expect(r.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-15T22:00:00.000Z');
  });

  it('handles the change to winter time', () => {
    const r = parseDateRange('2026-10-25', '2026-10-25', 90)!;
    expect(r.to.getTime() - r.from.getTime()).toBe(25 * 3_600_000);
  });

  it('refuses reversed, too long, missing and impossible periods', () => {
    expect(parseDateRange('2026-10-15', '2026-10-01', 90)).toBeNull();
    expect(parseDateRange('2026-01-01', '2026-12-31', 90)).toBeNull();
    expect(parseDateRange(undefined, '2026-10-01', 90)).toBeNull();
    expect(parseDateRange('2026-02-30', '2026-03-01', 90)).toBeNull();
    expect(parseDateRange('1.10.2026', '2026-10-02', 90)).toBeNull();
  });

  it('knows when a period is exactly one month', () => {
    expect(monthOf(parseDateRange('2026-02-01', '2026-02-28', 90)!)).toEqual({
      year: 2026,
      month: 2,
    });
    expect(monthOf(parseDateRange('2026-02-02', '2026-02-28', 90)!)).toBeNull();
  });
});

describe('days', () => {
  it('adds days across months and tells today in Copenhagen', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(copenhagenToday(new Date('2026-10-20T22:30:00Z'))).toBe('2026-10-21');
  });
});
