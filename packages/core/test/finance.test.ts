import { describe, expect, it } from 'vitest';
import {
  nextRetryAt,
  roundUpQuarter,
  subscriptionPriceOre,
  supportLines,
  supportMonth,
  supportTotals,
  type SupportEntry,
} from '../src/finance.js';

const entry = (o: Partial<SupportEntry>): SupportEntry => ({
  id: 'e',
  caseId: 'c1',
  caseNumber: 2291,
  caseTitle: 'Fakturaer til EU-kunder fejler',
  minutes: 10,
  billable: true,
  workDate: '2026-10-19',
  source: 'manual',
  ...o,
});

describe('support billing', () => {
  it('rounds each registration up to 15 minutes', () => {
    expect(roundUpQuarter(0)).toBe(0);
    expect(roundUpQuarter(1)).toBe(15);
    expect(roundUpQuarter(15)).toBe(15);
    expect(roundUpQuarter(16)).toBe(30);
    expect(roundUpQuarter(42)).toBe(45);
  });

  it('rounds per registration, not per total', () => {
    const lines = supportLines(
      [
        entry({ id: 'a', minutes: 10 }),
        entry({ id: 'b', minutes: 10 }),
        entry({ id: 'c', minutes: 10 }),
      ],
      64_000,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.registeredMinutes).toBe(30);
    // 3 × 15 min, not round(30) = 30.
    expect(lines[0]!.billedMinutes).toBe(45);
    expect(lines[0]!.amountOre).toBe(48_000);
  });

  it('leaves out time without a case and time that is not billable', () => {
    const lines = supportLines(
      [
        entry({ id: 'a', minutes: 60 }),
        entry({ id: 'b', minutes: 20, billable: false }),
        entry({ id: 'c', minutes: 30, caseId: null, caseNumber: null }),
      ],
      64_000,
    );
    expect(lines.map((l) => l.entryIds)).toEqual([['a']]);
    expect(supportTotals(lines)).toMatchObject({
      billed: 60,
      net: 64_000,
      vat: 16_000,
      gross: 80_000,
    });
  });

  it('groups by case, ordered by case number', () => {
    const lines = supportLines(
      [
        entry({ id: 'a', caseId: 'c2', caseNumber: 2300, minutes: 35, source: 'auto' }),
        entry({ id: 'b', caseId: 'c1', caseNumber: 2271, minutes: 125 }),
      ],
      64_000,
    );
    expect(lines.map((l) => [l.caseNumber, l.billedMinutes, l.sessions, l.entries])).toEqual([
      [2271, 135, 0, 1],
      [2300, 45, 1, 0],
    ]);
  });
});

describe('subscriptions', () => {
  it('prices a year as 10 months and applies an active discount', () => {
    expect(subscriptionPriceOre({ monthlyOre: 15_900, interval: 'year' })).toBe(159_000);
    expect(subscriptionPriceOre({ monthlyOre: 7_900, interval: 'month', discountPct: 50 })).toBe(
      3_950,
    );
    const past = new Date('2026-01-01T00:00:00Z');
    expect(
      subscriptionPriceOre({
        monthlyOre: 7_900,
        interval: 'month',
        discountPct: 50,
        discountUntil: past,
      }),
    ).toBe(7_900);
  });

  it('retries failed charges after 2, 5 and 9 days, then stops', () => {
    const t = new Date('2026-10-01T06:00:00Z');
    const days = (d: Date | null) => (d ? (d.getTime() - t.getTime()) / 86_400_000 : null);
    expect([1, 2, 3, 4].map((n) => days(nextRetryAt(t, n)))).toEqual([2, 5, 9, null]);
  });

  it('sends support invoices on the 1st at 08:00 Copenhagen time', () => {
    expect(supportMonth(2026, 10).sendAt.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(supportMonth(2026, 7).sendAt.toISOString()).toBe('2026-08-01T06:00:00.000Z');
    expect(supportMonth(2026, 12).lastDay).toBe('2026-12-31');
  });
});
