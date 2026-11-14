import { copenhagenTime } from '@agentor/core';

/** A period of whole Copenhagen days, as picked with Fra/til (S7, A3, A4, F7). */
export interface DateRange {
  /** First day, YYYY-MM-DD. */
  fromIso: string;
  /** Last day (inclusive), YYYY-MM-DD. */
  toIso: string;
  /** Start of the first day. */
  from: Date;
  /** Start of the day after the last day (exclusive). */
  to: Date;
  days: number;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(iso: string | undefined): [number, number, number] | null {
  const m = iso ? ISO_DAY.exec(iso) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null;
  return [y, mo, d];
}

/** Today's date in Copenhagen, YYYY-MM-DD. */
export function copenhagenToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDaysIso(iso: string, days: number): string {
  const p = parts(iso);
  if (!p) throw new Error(`Not a date: ${iso}`);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Parses ?from=&to= (YYYY-MM-DD, both inclusive). Returns null when either is missing or not a
 * real date, when from is after to, or when the period is longer than maxDays.
 */
export function parseDateRange(
  fromIso: string | undefined,
  toIso: string | undefined,
  maxDays: number,
): DateRange | null {
  const f = parts(fromIso);
  const t = parts(toIso);
  if (!f || !t) return null;
  const days =
    Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000) + 1;
  if (days < 1 || days > maxDays) return null;
  const after = addDaysIso(toIso!, 1).split('-').map(Number) as [number, number, number];
  return {
    fromIso: fromIso!,
    toIso: toIso!,
    from: copenhagenTime(f[0], f[1], f[2]),
    to: copenhagenTime(after[0], after[1], after[2]),
    days,
  };
}

/** The calendar month a date range starts in, when the range is exactly that month. */
export function monthOf(range: DateRange): { year: number; month: number } | null {
  const [y, m, d] = range.fromIso.split('-').map(Number) as [number, number, number];
  if (d !== 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return range.toIso === `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    ? { year: y, month: m }
    : null;
}

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'lastQuarter' | 'yearToDate';
export const PERIOD_PRESETS: PeriodPreset[] = [
  'thisMonth',
  'lastMonth',
  'lastQuarter',
  'yearToDate',
];

const lastDayOfMonth = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
const firstDay = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;

/**
 * The report period presets in Copenhagen days (Rapporter › Periode): this month and last month
 * as whole months, the last whole calendar quarter, and 1 January to today.
 */
export function presetRange(
  preset: PeriodPreset,
  now = new Date(),
): { fromIso: string; toIso: string } {
  const today = copenhagenToday(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (preset) {
    case 'thisMonth':
      return { fromIso: firstDay(y, m), toIso: lastDayOfMonth(y, m) };
    case 'lastMonth': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { fromIso: firstDay(py, pm), toIso: lastDayOfMonth(py, pm) };
    }
    case 'lastQuarter': {
      const q = Math.floor((m - 1) / 3); // 0-based quarter we're in
      const [qy, qStart] = q === 0 ? [y - 1, 10] : [y, (q - 1) * 3 + 1];
      return { fromIso: firstDay(qy, qStart), toIso: lastDayOfMonth(qy, qStart + 2) };
    }
    case 'yearToDate':
      return { fromIso: `${y}-01-01`, toIso: today };
  }
}

/** Which preset a ?from=&to= period is, or null when it is a picked range. */
export function presetOf(fromIso: string, toIso: string, now = new Date()): PeriodPreset | null {
  return (
    PERIOD_PRESETS.find((p) => {
      const r = presetRange(p, now);
      return r.fromIso === fromIso && r.toIso === toIso;
    }) ?? null
  );
}
