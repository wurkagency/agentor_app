import { roundUpQuarter } from '@agentor/core';
import { listCases, supportPrice, type FinanceInvoice, type StaffActor } from '@agentor/db';
import { cache } from 'react';
import { addDaysIso, copenhagenToday, parseDateRange, type DateRange } from './date-range';
import {
  counted,
  daysBetween,
  financeInvoicesAll,
  financeTimeFor,
  growthPct,
  paymentState,
  type PaymentState,
} from './finance-data';
import { db } from './infra';
import { tenantNames } from './platform-data';

/**
 * Administration › Rapporter (A3 Support og tid, A4 Fakturering): one loader per report for a
 * Fra/til period, used by the page, the CSV and the PDF so they always show the same rows. Money
 * in øre; Support og tid ex. VAT, Fakturering incl. VAT (as on the boards).
 */

export const REPORT_MAX_DAYS = 366;

/**
 * The period a report shows: ?from=&to= when valid, else the board's default (Support og tid the
 * last closed month, Fakturering the current month).
 */
export function reportRange(
  type: 'support' | 'invoicing',
  sp: { from?: string | undefined; to?: string | undefined },
  now = new Date(),
): { range: DateRange; invalid: boolean } {
  const given = parseDateRange(sp.from, sp.to, REPORT_MAX_DAYS);
  if (given) return { range: given, invalid: false };
  const today = copenhagenToday(now);
  const first = `${today.slice(0, 7)}-01`;
  const lastOfMonth = (firstDay: string) =>
    addDaysIso(addDaysIso(firstDay, 32).slice(0, 7) + '-01', -1);
  const start = type === 'support' ? addDaysIso(first, -1).slice(0, 7) + '-01' : first;
  return {
    range: parseDateRange(start, lastOfMonth(start), REPORT_MAX_DAYS)!,
    invalid: Boolean(sp.from || sp.to),
  };
}

/** The same length of time just before a period, for the growth badges. */
export function previousRange(r: DateRange): DateRange {
  const to = addDaysIso(r.fromIso, -1);
  const from = addDaysIso(to, -(r.days - 1));
  return parseDateRange(from, to, REPORT_MAX_DAYS)!;
}

/* ---- Support og tid (A3) ------------------------------------------------------------------------- */

export interface SupportReport {
  range: DateRange;
  registeredMinutes: number;
  billedMinutes: number;
  nonBillableMinutes: number;
  casesResolved: number;
  customersResolved: number;
  medianResolvedMinutes: number | null;
  autoShare: number;
  netOre: number;
  previous: {
    registeredMinutes: number;
    billedMinutes: number;
    nonBillableMinutes: number;
    casesResolved: number;
  };
  perStaff: {
    name: string;
    billable: number;
    nonBillable: number;
    cases: number;
    autoShare: number;
  }[];
  perCategory: { category: string; minutes: number; cases: number; share: number }[];
  topCustomers: {
    tenantId: string;
    name: string;
    cases: number;
    billedMinutes: number;
    netOre: number;
    share: number;
  }[];
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Support time in a period, billed with the support price in force in each month (A2). */
async function supportFigures(actor: StaffActor, range: DateRange) {
  const entries = await financeTimeFor(actor, range.fromIso, range.toIso);
  const months = [...new Set(entries.map((e) => e.workDate.slice(0, 7)))];
  const prices = new Map(
    await Promise.all(
      months.map(async (m) => {
        const r = parseDateRange(`${m}-01`, `${m}-01`, 1)!;
        return [m, await supportPrice(db(), actor, r.from)] as const;
      }),
    ),
  );
  const billed = (e: (typeof entries)[number]) => {
    if (!e.billable || !e.caseId) return { minutes: 0, ore: 0 };
    const p = prices.get(e.workDate.slice(0, 7))!;
    const minutes = roundUpQuarter(e.minutes, p.roundingMinutes);
    return { minutes, ore: Math.round((minutes / 60) * p.rateOre) };
  };
  const onCases = entries.filter((e) => e.caseId);
  return {
    entries,
    billed,
    registered: onCases.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0),
    billedMinutes: entries.reduce((a, e) => a + billed(e).minutes, 0),
    nonBillable: onCases.filter((e) => !e.billable).reduce((a, e) => a + e.minutes, 0),
  };
}

export const supportReport = cache(
  async (actor: StaffActor, range: DateRange): Promise<SupportReport> => {
    const prevRange = previousRange(range);
    const names = await tenantNames(actor.userId);
    const [cur, prev, cases] = await Promise.all([
      supportFigures(actor, range),
      supportFigures(actor, prevRange),
      listCases(db(), actor.userId, names, {}),
    ]);
    const inRange = (d: Date | null, r: DateRange) => Boolean(d && d >= r.from && d < r.to);
    const resolved = cases.filter((c) => inRange(c.resolvedAt, range));
    const minutesOn = new Map<string, number>();
    for (const e of cur.entries)
      if (e.caseId) minutesOn.set(e.caseId, (minutesOn.get(e.caseId) ?? 0) + e.minutes);
    const perCase = resolved
      .map((c) => minutesOn.get(c.id) ?? 0)
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    const all = cur.entries.reduce((a, e) => a + e.minutes, 0);
    const auto = cur.entries.filter((e) => e.source === 'auto').reduce((a, e) => a + e.minutes, 0);

    const staff = new Map<
      string,
      {
        name: string;
        billable: number;
        nonBillable: number;
        cases: Set<string>;
        auto: number;
        all: number;
      }
    >();
    const category = new Map<string, { minutes: number; cases: Set<string> }>();
    const customers = new Map<
      string,
      { name: string; cases: Set<string>; billedMinutes: number; netOre: number }
    >();
    let netOre = 0;
    for (const e of cur.entries) {
      const s = staff.get(e.staffUserId) ?? {
        name: e.staffName,
        billable: 0,
        nonBillable: 0,
        cases: new Set<string>(),
        auto: 0,
        all: 0,
      };
      if (e.billable && e.caseId) s.billable += e.minutes;
      else s.nonBillable += e.minutes;
      if (e.caseId) s.cases.add(e.caseId);
      s.all += e.minutes;
      if (e.source === 'auto') s.auto += e.minutes;
      staff.set(e.staffUserId, s);
      if (e.caseId) {
        const k = e.caseCategory ?? 'question';
        const c = category.get(k) ?? { minutes: 0, cases: new Set<string>() };
        c.minutes += e.minutes;
        c.cases.add(e.caseId);
        category.set(k, c);
      }
      const b = cur.billed(e);
      netOre += b.ore;
      const cu = customers.get(e.tenantId) ?? {
        name: names.get(e.tenantId) ?? '',
        cases: new Set<string>(),
        billedMinutes: 0,
        netOre: 0,
      };
      if (e.caseId) cu.cases.add(e.caseId);
      cu.billedMinutes += b.minutes;
      cu.netOre += b.ore;
      customers.set(e.tenantId, cu);
    }
    const categoryTotal = [...category.values()].reduce((a, c) => a + c.minutes, 0);
    return {
      range,
      registeredMinutes: cur.registered,
      billedMinutes: cur.billedMinutes,
      nonBillableMinutes: cur.nonBillable,
      casesResolved: resolved.length,
      customersResolved: new Set(resolved.map((c) => c.tenantId)).size,
      medianResolvedMinutes: perCase.length ? perCase[Math.floor((perCase.length - 1) / 2)]! : null,
      autoShare: share(auto, all),
      netOre,
      previous: {
        registeredMinutes: prev.registered,
        billedMinutes: prev.billedMinutes,
        nonBillableMinutes: prev.nonBillable,
        casesResolved: cases.filter((c) => inRange(c.resolvedAt, prevRange)).length,
      },
      perStaff: [...staff.values()]
        .map((s) => ({
          name: s.name,
          billable: s.billable,
          nonBillable: s.nonBillable,
          cases: s.cases.size,
          autoShare: share(s.auto, s.all),
        }))
        .sort((a, b) => b.billable - a.billable),
      perCategory: [...category.entries()]
        .map(([k, c]) => ({
          category: k,
          minutes: c.minutes,
          cases: c.cases.size,
          share: share(c.minutes, categoryTotal),
        }))
        .sort((a, b) => b.minutes - a.minutes),
      topCustomers: [...customers.entries()]
        .filter(([, c]) => c.netOre > 0)
        .map(([tenantId, c]) => ({
          tenantId,
          name: c.name,
          cases: c.cases.size,
          billedMinutes: c.billedMinutes,
          netOre: c.netOre,
          share: share(c.netOre, netOre),
        }))
        .sort((a, b) => b.netOre - a.netOre)
        .slice(0, 10),
    };
  },
);

/* ---- Fakturering (A4) ---------------------------------------------------------------------------- */

export type InvoiceFilter = 'all' | 'paid' | 'outstanding' | 'subscription' | 'support';
export const INVOICE_FILTERS: InvoiceFilter[] = [
  'all',
  'paid',
  'outstanding',
  'subscription',
  'support',
];

export interface InvoiceReportRow {
  invoice: FinanceInvoice;
  state: PaymentState;
  issued: Date;
  daysToPay: number | null;
}

export interface InvoicingReport {
  range: DateRange;
  rows: InvoiceReportRow[];
  invoicedOre: number;
  paidOre: number;
  outstandingOre: number;
  outstandingCount: number;
  cardFailed: number;
  overdue: number;
  avgDaysToPay: number | null;
  medianDaysToPay: number | null;
  counts: Record<InvoiceFilter, number>;
  previous: {
    invoicedOre: number;
    paidShare: number;
    outstandingCount: number;
    avgDaysToPay: number | null;
  };
}

const issuedAt = (i: FinanceInvoice) => i.issuedAt ?? i.createdAt;

function invoicingFigures(invoices: FinanceInvoice[], range: DateRange, now: Date) {
  const rows: InvoiceReportRow[] = invoices
    .filter((i) => counted(i) && issuedAt(i) >= range.from && issuedAt(i) < range.to)
    .map((i) => ({
      invoice: i,
      state: paymentState(i, now),
      issued: issuedAt(i),
      daysToPay: i.status === 'paid' && i.paidAt ? daysBetween(issuedAt(i), i.paidAt) : null,
    }))
    .sort(
      (a, b) =>
        a.issued.getTime() - b.issued.getTime() ||
        (a.invoice.number ?? '').localeCompare(b.invoice.number ?? ''),
    );
  const invoicedOre = rows.reduce((a, r) => a + r.invoice.grossOre, 0);
  const paid = rows.filter((r) => r.state === 'paid');
  const paidOre = paid.reduce((a, r) => a + r.invoice.grossOre, 0);
  const outstanding = rows.filter((r) => r.state !== 'paid');
  const days = paid.map((r) => r.daysToPay ?? 0).sort((a, b) => a - b);
  return {
    rows,
    invoicedOre,
    paidOre,
    outstandingOre: outstanding.reduce((a, r) => a + r.invoice.grossOre, 0),
    outstandingCount: outstanding.length,
    cardFailed: rows.filter((r) => r.state === 'card_failed' || r.state === 'retrying').length,
    overdue: rows.filter((r) => r.state === 'overdue' || r.state === 'reminded').length,
    avgDaysToPay: days.length
      ? Math.round((days.reduce((a, d) => a + d, 0) / days.length) * 10) / 10
      : null,
    medianDaysToPay: days.length ? days[Math.floor((days.length - 1) / 2)]! : null,
  };
}

export const invoicingReport = cache(
  async (actor: StaffActor, range: DateRange, now = new Date()): Promise<InvoicingReport> => {
    const invoices = await financeInvoicesAll(actor);
    const cur = invoicingFigures(invoices, range, now);
    const prev = invoicingFigures(invoices, previousRange(range), now);
    const counts = {
      all: cur.rows.length,
      paid: cur.rows.filter((r) => r.state === 'paid').length,
      outstanding: cur.outstandingCount,
      subscription: cur.rows.filter((r) => r.invoice.kind === 'subscription').length,
      support: cur.rows.filter((r) => r.invoice.kind === 'support').length,
    };
    return {
      range,
      ...cur,
      counts,
      previous: {
        invoicedOre: prev.invoicedOre,
        paidShare: share(prev.paidOre, prev.invoicedOre),
        outstandingCount: prev.outstandingCount,
        avgDaysToPay: prev.avgDaysToPay,
      },
    };
  },
);

export function filterInvoices(rows: InvoiceReportRow[], f: InvoiceFilter): InvoiceReportRow[] {
  if (f === 'paid') return rows.filter((r) => r.state === 'paid');
  if (f === 'outstanding') return rows.filter((r) => r.state !== 'paid');
  if (f === 'subscription' || f === 'support') return rows.filter((r) => r.invoice.kind === f);
  return rows;
}

export { growthPct };
