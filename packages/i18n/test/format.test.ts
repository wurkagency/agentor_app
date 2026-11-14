import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatOrderNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from '../src/format.js';

// Intl output uses non-breaking spaces in places; normalise for readable assertions.
const n = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('Danish formats (designspecifikation §9.3)', () => {
  it('formats money as 1.234,50 kr.', () => {
    expect(n(formatMoney(1234.5))).toBe('1.234,50 kr.');
    expect(n(formatMoney(184320))).toBe('184.320,00 kr.');
  });

  it('formats whole numbers with a dot as thousands separator', () => {
    expect(formatNumber(184320)).toBe('184.320');
    expect(formatNumber(1906)).toBe('1.906');
  });

  it('formats percentages with a comma', () => {
    expect(n(formatPercent(0.004))).toBe('0,4 %');
  });

  it('formats dates as 18. okt. 2026', () => {
    expect(formatDate(new Date('2026-10-18T12:00:00Z'))).toBe('18. okt. 2026');
  });

  it('formats time in Copenhagen time, 24 h', () => {
    expect(formatTime(new Date('2026-10-18T12:02:00Z'))).toBe('14:02');
    expect(formatDateTime(new Date('2026-10-18T12:02:00Z'))).toBe('18. okt. 2026 kl. 14:02');
  });

  it('formats relative time as "for 4 min. siden"', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    expect(n(formatRelative(new Date('2026-10-18T11:56:00Z'), now))).toBe('for 4 min. siden');
    expect(formatRelative(new Date('2026-10-18T11:59:50Z'), now)).toBe('lige nu');
    expect(n(formatRelative(new Date('2026-10-18T09:00:00Z'), now))).toBe('for 3 t. siden');
  });

  it('prefixes order numbers with #', () => {
    expect(formatOrderNumber(10432)).toBe('#10432');
    expect(formatOrderNumber('#10447')).toBe('#10447');
  });

  it('has an English variant', () => {
    expect(n(formatMoney(1234.5, 'en'))).toBe('DKK 1,234.50');
    expect(formatDate(new Date('2026-10-18T12:00:00Z'), 'en')).toBe('18 Oct 2026');
  });
});
