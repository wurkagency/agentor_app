import { addMonth, withVat } from './entitlements.js';

/**
 * Finance rules (README decision 18). Pure functions, shared by the app, the worker and the
 * scheduler, so the numbers on Finans are the numbers on the invoices.
 */

/** A year costs 10 months. */
export const YEARLY_MONTHS = 10;
/** Default support rate: 800 kr. an hour incl. VAT = 640 kr. ex. VAT. Superadmin can change it. */
export const DEFAULT_SUPPORT_RATE_ORE = 64_000;
/** Failed card charges are retried this many days after the first attempt. */
export const RETRY_DAYS = [2, 5, 9] as const;
/** Payment terms for invoices paid by bank transfer or EAN. */
export const INVOICE_DUE_DAYS = 8;
/** Support time is billed in quarters of an hour. */
export const BILLING_STEP_MINUTES = 15;

/**
 * Each registration (session or manual entry) is rounded up to the next step: 15 minutes unless
 * the support price version says otherwise (A2 "Oprunding").
 */
export function roundUpQuarter(minutes: number, step = BILLING_STEP_MINUTES): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / step) * step;
}

export function addYear(date: Date): Date {
  let d = date;
  for (let i = 0; i < 12; i++) d = addMonth(d);
  return d;
}

export function periodEndFor(start: Date, interval: 'month' | 'year'): Date {
  return interval === 'year' ? addYear(start) : addMonth(start);
}

/** Net price of one billing period after an active discount. */
export function subscriptionPriceOre(input: {
  monthlyOre: number;
  interval: 'month' | 'year';
  discountPct?: number | null;
  discountUntil?: Date | null;
  at?: Date;
}): number {
  const base = input.interval === 'year' ? input.monthlyOre * YEARLY_MONTHS : input.monthlyOre;
  const at = input.at ?? new Date();
  const active =
    input.discountPct && (!input.discountUntil || input.discountUntil.getTime() > at.getTime());
  return active ? Math.round(base * (1 - input.discountPct! / 100)) : base;
}

/** Monthly recurring revenue of a subscription: a yearly price counts as 1/12 a month. */
export function monthlyRecurringOre(periodPriceOre: number, interval: 'month' | 'year'): number {
  return interval === 'year' ? Math.round(periodPriceOre / 12) : periodPriceOre;
}

/** When to try a failed charge again; null after the last retry. */
export function nextRetryAt(firstFailedAt: Date, attempts: number): Date | null {
  const days = RETRY_DAYS[attempts - 1];
  if (days === undefined) return null;
  return new Date(firstFailedAt.getTime() + days * 86_400_000);
}

export interface SupportEntry {
  id: string;
  caseId: string | null;
  caseNumber: number | null;
  caseTitle: string | null;
  minutes: number;
  billable: boolean;
  workDate: string;
  source: string;
}

export interface SupportLine {
  caseId: string;
  caseNumber: number;
  text: string;
  registeredMinutes: number;
  billedMinutes: number;
  rateOre: number;
  amountOre: number;
  entryIds: string[];
  entries: number;
  sessions: number;
  firstDate: string;
  lastDate: string;
}

/**
 * Support lines for one customer and month: one line per case, each registration rounded up to
 * the version's step (15 min.). Time without a case and time marked not billable never count.
 */
export function supportLines(
  entries: readonly SupportEntry[],
  rateOre: number,
  roundingMinutes = BILLING_STEP_MINUTES,
): SupportLine[] {
  const byCase = new Map<string, SupportLine>();
  for (const e of entries) {
    if (!e.billable || !e.caseId || e.caseNumber === null || e.minutes <= 0) continue;
    let line = byCase.get(e.caseId);
    if (!line) {
      line = {
        caseId: e.caseId,
        caseNumber: e.caseNumber,
        text: `#${e.caseNumber} ${e.caseTitle ?? ''}`.trim(),
        registeredMinutes: 0,
        billedMinutes: 0,
        rateOre,
        amountOre: 0,
        entryIds: [],
        entries: 0,
        sessions: 0,
        firstDate: e.workDate,
        lastDate: e.workDate,
      };
      byCase.set(e.caseId, line);
    }
    line.registeredMinutes += e.minutes;
    line.billedMinutes += roundUpQuarter(e.minutes, roundingMinutes);
    line.entryIds.push(e.id);
    if (e.source === 'auto') line.sessions += 1;
    else line.entries += 1;
    if (e.workDate < line.firstDate) line.firstDate = e.workDate;
    if (e.workDate > line.lastDate) line.lastDate = e.workDate;
  }
  const lines = [...byCase.values()];
  for (const l of lines) l.amountOre = Math.round((l.billedMinutes / 60) * rateOre);
  return lines.sort((a, b) => a.caseNumber - b.caseNumber);
}

export function supportTotals(lines: readonly SupportLine[]) {
  const registered = lines.reduce((a, l) => a + l.registeredMinutes, 0);
  const billed = lines.reduce((a, l) => a + l.billedMinutes, 0);
  const net = lines.reduce((a, l) => a + l.amountOre, 0);
  return { registered, billed, ...withVat(net) };
}

/** Year and month (1–12) of a date in Copenhagen time. */
export function copenhagenMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year')!.value),
    month: Number(parts.find((p) => p.type === 'month')!.value),
  };
}

/** A Copenhagen wall-clock time as an instant (handles summer time). */
export function copenhagenTime(year: number, month: number, day: number, hour = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/** The month that starts at `start` (Copenhagen) and the support send time: the 1st at 08:00. */
export function supportMonth(year: number, month: number) {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: copenhagenTime(year, month, 1),
    end: copenhagenTime(next.year, next.month, 1),
    sendAt: copenhagenTime(next.year, next.month, 1, 8),
    firstDay: `${year}-${String(month).padStart(2, '0')}-01`,
    lastDay: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}
