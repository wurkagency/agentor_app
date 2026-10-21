import {
  copenhagenMonth,
  monthlyRecurringOre,
  subscriptionPriceOre,
  supportLines,
  supportMonth,
  supportTotals,
  withVat,
  type SupportLine,
} from '@agentor/core';
import {
  financeInvoices,
  financeSubscriptions,
  financeTime,
  listPlans,
  supportRateOre,
  type FinanceInvoice,
  type FinanceSubscription,
  type FinanceTimeEntry,
  type StaffActor,
} from '@agentor/db';
import { cache } from 'react';
import { db } from './infra';

/**
 * Finans view models (F1–F7). Everything is computed from the real subscriptions, invoices and
 * support time; amounts are øre. Reports are ex. VAT, invoices and support billing incl. VAT
 * (README decision 18).
 */

export interface Month {
  year: number;
  month: number;
  key: string;
  start: Date;
  end: Date;
  firstDay: string;
  lastDay: string;
}

export function monthOf(year: number, month: number): Month {
  const m = supportMonth(year, month);
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    start: m.start,
    end: m.end,
    firstDay: m.firstDay,
    lastDay: m.lastDay,
  };
}

export function shiftMonth(m: { year: number; month: number }, by: number): Month {
  const i = m.year * 12 + (m.month - 1) + by;
  return monthOf(Math.floor(i / 12), (i % 12) + 1);
}

export function currentMonth(now = new Date()): Month {
  const c = copenhagenMonth(now);
  return monthOf(c.year, c.month);
}

/** "2026-10" from a query string, within the last 24 months; else the current month. */
export function parseMonth(value: string | undefined, now = new Date()): Month {
  const cur = currentMonth(now);
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!m) return cur;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return cur;
  const diff = cur.year * 12 + cur.month - (y * 12 + mo);
  return diff >= 0 && diff <= 24 ? monthOf(y, mo) : cur;
}

/**
 * The month a report shows, from ?from=YYYY-MM-DD (Administration › Rapporter, README decision
 * 24) or the older ?month=YYYY-MM.
 */
export function monthFromQuery(
  q: { from?: string | null | undefined; month?: string | null | undefined },
  now = new Date(),
): Month | null {
  const key = q.from ? q.from.slice(0, 7) : q.month;
  return key ? parseMonth(key, now) : null;
}

/** ?from=&to= for a whole month, as the report links and exports use. */
export function monthQuery(m: Month): string {
  const last = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
  const mm = String(m.month).padStart(2, '0');
  return `from=${m.year}-${mm}-01&to=${m.year}-${mm}-${String(last).padStart(2, '0')}`;
}

export const monthsBack = (to: Month, n: number) =>
  Array.from({ length: n }, (_, i) => shiftMonth(to, i - n + 1));

/* ---- Loading (cached per request) --------------------------------------------------------------- */

export const financeSubs = cache((actor: StaffActor) => financeSubscriptions(db(), actor));

/** Invoices from 13 months before the current month up to the end of next month. */
export const financeInvoicesAll = cache(async (actor: StaffActor) => {
  const cur = currentMonth();
  return financeInvoices(db(), actor, shiftMonth(cur, -24).start, shiftMonth(cur, 2).start);
});

export const financeTimeFor = cache((actor: StaffActor, firstDay: string, lastDay: string) =>
  financeTime(db(), actor, firstDay, lastDay),
);

export const financeRate = cache((actor: StaffActor) => supportRateOre(db(), actor));

export const planPrices = cache(async () => {
  const plans = await listPlans(db());
  return new Map(plans.map((p) => [p.id, { name: p.name, monthlyOre: p.priceMonthlyOre }]));
});

/* ---- Subscriptions ------------------------------------------------------------------------------ */

export type SubState =
  'paid' | 'failed' | 'renews' | 'cancelled' | 'card_expiring' | 'trial' | 'ended';

export interface SubRow extends FinanceSubscription {
  planName: string;
  priceOre: number;
  mrrOre: number;
  state: SubState;
  nextChargeAt: Date | null;
  retryAt: Date | null;
}

export const isLive = (s: FinanceSubscription) => s.status === 'active' || s.status === 'past_due';

function cardExpiresWithin(expiry: string | null, now: Date, days: number): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry ?? '');
  if (!m) return false;
  const end = new Date(Date.UTC(2000 + Number(m[2]), Number(m[1]), 1));
  return end.getTime() - now.getTime() < days * 86_400_000 && end.getTime() > now.getTime();
}

export async function subscriptionRows(actor: StaffActor, now = new Date()): Promise<SubRow[]> {
  const [subs, prices, invoices] = await Promise.all([
    financeSubs(actor),
    planPrices(),
    financeInvoicesAll(actor),
  ]);
  const failed = new Map(
    invoices
      .filter((i) => i.kind === 'subscription' && i.status === 'failed')
      .map((i) => [i.tenantId, i]),
  );
  return subs.map((s) => {
    const plan = prices.get(s.planId);
    const priceOre = subscriptionPriceOre({
      monthlyOre: plan?.monthlyOre ?? 0,
      interval: s.interval,
      discountPct: s.discountPct,
      discountUntil: s.discountUntil,
      at: now,
    });
    const trial = Boolean(s.trialEndsAt && s.trialEndsAt > now);
    const f = failed.get(s.tenantId);
    const state: SubState = !isLive(s)
      ? 'ended'
      : trial
        ? 'trial'
        : s.cancelAt
          ? 'cancelled'
          : f
            ? 'failed'
            : cardExpiresWithin(s.cardExpiry, now, 31) && s.paymentMethod === 'card'
              ? 'card_expiring'
              : s.interval === 'year' &&
                  s.currentPeriodEnd &&
                  s.currentPeriodEnd.getTime() - now.getTime() < 30 * 86_400_000
                ? 'renews'
                : 'paid';
    return {
      ...s,
      planName: plan?.name ?? s.planId,
      priceOre,
      mrrOre: isLive(s) && !trial ? monthlyRecurringOre(priceOre, s.interval) : 0,
      state,
      nextChargeAt: s.cancelAt ? null : s.trialEndsAt && trial ? s.trialEndsAt : s.currentPeriodEnd,
      retryAt: f?.nextRetryAt ?? null,
    };
  });
}

/**
 * Monthly recurring revenue per month: each subscription invoice spread over the months its
 * period covers (a yearly invoice counts 1/12 a month).
 */
export function mrrSeries(invoices: FinanceInvoice[], months: Month[]): number[] {
  const subs = invoices.filter(
    (i) => i.kind === 'subscription' && i.status !== 'void' && i.status !== 'draft',
  );
  return months.map((m) => {
    const mid = new Date((m.start.getTime() + m.end.getTime()) / 2);
    let sum = 0;
    for (const i of subs) {
      if (i.periodStart <= mid && i.periodEnd > mid) {
        const months = Math.max(
          1,
          Math.round((i.periodEnd.getTime() - i.periodStart.getTime()) / (30.44 * 86_400_000)),
        );
        sum += i.netOre / months;
      }
    }
    return Math.round(sum);
  });
}

/* ---- Revenue ------------------------------------------------------------------------------------ */

export const counted = (i: FinanceInvoice) => i.status !== 'void' && i.status !== 'draft';
const issued = (i: FinanceInvoice) => i.issuedAt ?? i.createdAt;
const inMonth = (d: Date, m: Month) => d >= m.start && d < m.end;

export interface MonthRevenue {
  month: Month;
  subscriptionOre: number;
  supportOre: number;
  /** True for the open month: support is what is drafted or registered so far. */
  forecast: boolean;
}

/** Net revenue per month by invoice issue date; support is billed the month after the work. */
export function revenueByMonth(
  invoices: FinanceInvoice[],
  months: Month[],
  openSupportOre = 0,
): MonthRevenue[] {
  const cur = currentMonth();
  return months.map((m) => {
    const list = invoices.filter((i) => counted(i) && inMonth(issued(i), m));
    const support = list.filter((i) => i.kind === 'support').reduce((a, i) => a + i.netOre, 0);
    const isCurrent = m.key === cur.key;
    return {
      month: m,
      subscriptionOre: list
        .filter((i) => i.kind === 'subscription')
        .reduce((a, i) => a + i.netOre, 0),
      supportOre: support + (isCurrent ? openSupportOre : 0),
      forecast: isCurrent,
    };
  });
}

export interface DayRevenue {
  day: number;
  ore: number;
  cumulativeOre: number;
  future: boolean;
}

export function revenueByDay(invoices: FinanceInvoice[], m: Month, now = new Date()): DayRevenue[] {
  const days = Number(m.lastDay.slice(8, 10));
  const out: DayRevenue[] = [];
  let cum = 0;
  for (let d = 1; d <= days; d++) {
    const start = new Date(m.start.getTime() + (d - 1) * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    const ore = invoices
      .filter((i) => counted(i) && issued(i) >= start && issued(i) < end)
      .reduce((a, i) => a + i.netOre, 0);
    cum += ore;
    out.push({ day: d, ore, cumulativeOre: cum, future: start > now });
  }
  return out;
}

/* ---- Support billing (F3, F5) ------------------------------------------------------------------- */

export interface CustomerSupport {
  tenantId: string;
  tenantName: string;
  planName: string;
  lines: SupportLine[];
  registered: number;
  billed: number;
  netOre: number;
  grossOre: number;
  nonBillableMinutes: number;
  latestCase: { number: number; title: string } | null;
  cancelled: boolean;
  invoice: FinanceInvoice | null;
  entries: FinanceTimeEntry[];
}

export async function supportForMonth(
  actor: StaffActor,
  m: Month,
  filters: { staffUserId?: string } = {},
): Promise<{ customers: CustomerSupport[]; rateOre: number; entries: FinanceTimeEntry[] }> {
  const [entries, rateOre, subs, invoices] = await Promise.all([
    financeTimeFor(actor, m.firstDay, m.lastDay),
    financeRate(actor),
    subscriptionRows(actor),
    financeInvoicesAll(actor),
  ]);
  const list = filters.staffUserId
    ? entries.filter((e) => e.staffUserId === filters.staffUserId)
    : entries;
  const byTenant = new Map<string, FinanceTimeEntry[]>();
  for (const e of list) byTenant.set(e.tenantId, [...(byTenant.get(e.tenantId) ?? []), e]);
  const subBy = new Map(subs.map((s) => [s.tenantId, s]));
  const customers: CustomerSupport[] = [];
  for (const [tenantId, es] of byTenant) {
    const lines = supportLines(es, rateOre);
    const totals = supportTotals(lines);
    const sub = subBy.get(tenantId);
    const latest = [...es]
      .filter((e) => e.caseNumber !== null)
      .sort((a, b) => (b.caseNumber ?? 0) - (a.caseNumber ?? 0))[0];
    customers.push({
      tenantId,
      tenantName: sub?.tenantName ?? '',
      planName: sub?.planName ?? '',
      lines,
      registered: totals.registered,
      billed: totals.billed,
      netOre: totals.net,
      grossOre: totals.gross,
      nonBillableMinutes: es
        .filter((e) => !e.billable && e.caseId)
        .reduce((a, e) => a + e.minutes, 0),
      latestCase: latest ? { number: latest.caseNumber!, title: latest.caseTitle ?? '' } : null,
      cancelled: Boolean(sub?.cancelAt),
      invoice:
        invoices.find(
          (i) =>
            i.kind === 'support' &&
            i.tenantId === tenantId &&
            i.periodStart.getTime() === m.start.getTime(),
        ) ?? null,
      entries: es,
    });
  }
  customers.sort((a, b) => b.grossOre - a.grossOre);
  return { customers, rateOre, entries: list };
}

/** Projected billable minutes at month end from the pace so far. */
export function projectMinutes(minutes: number, m: Month, now = new Date()): number {
  if (now >= m.end) return minutes;
  if (now <= m.start) return 0;
  const done = (now.getTime() - m.start.getTime()) / (m.end.getTime() - m.start.getTime());
  return done > 0 ? Math.round(minutes / done) : minutes;
}

/* ---- Payments (F6) ------------------------------------------------------------------------------ */

export type PaymentState =
  'overdue' | 'reminded' | 'card_failed' | 'retrying' | 'awaiting' | 'paid' | 'draft';

export function paymentState(i: FinanceInvoice, now = new Date()): PaymentState {
  if (i.status === 'draft') return 'draft';
  if (i.status === 'paid') return 'paid';
  if (i.status === 'failed') return i.nextRetryAt ? 'retrying' : 'card_failed';
  if (i.dueAt && i.dueAt < now) return i.reminders > 0 ? 'reminded' : 'overdue';
  return 'awaiting';
}

export const needsAction = (s: PaymentState) =>
  s === 'overdue' || s === 'reminded' || s === 'card_failed' || s === 'retrying';

export const daysBetween = (a: Date, b: Date) =>
  Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Growth badge figures: change in percent against the previous value, or null. */
export function growthPct(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / before) * 100;
}

export const gross = (netOre: number) => withVat(netOre).gross;

/* ---- Monthly report (F7) ------------------------------------------------------------------------ */

export interface MonthReport {
  month: Month;
  open: boolean;
  subscriptionOre: number;
  supportOre: number;
  revenueOre: number;
  activeAtEnd: number;
  billableMinutes: number;
  billedMinutes: number;
  nonBillableMinutes: number;
  autoShare: number;
  outstandingGross: number;
  paidShare: number;
  oldestOverdueDays: number;
  customersBilled: number;
  casesResolved: number;
  cancelled: number;
  newSubs: number;
  topCustomers: { tenantId: string; name: string; billedMinutes: number; netOre: number }[];
  perStaff: { name: string; billable: number; nonBillable: number; cases: number }[];
}

export async function monthReport(
  actor: StaffActor,
  m: Month,
  now = new Date(),
): Promise<MonthReport> {
  const [subs, invoices, support] = await Promise.all([
    subscriptionRows(actor, now),
    financeInvoicesAll(actor),
    supportForMonth(actor, m),
  ]);
  const open = now < m.end;
  const subsInvoices = invoices.filter(
    (i) => counted(i) && i.kind === 'subscription' && inMonth(issued(i), m),
  );
  const supportInvoices = invoices.filter(
    (i) => i.kind === 'support' && counted(i) && i.periodStart.getTime() === m.start.getTime(),
  );
  // Support for a month is the work done in it: the sent invoices, or the live figures while open.
  const supportOre = supportInvoices.length
    ? supportInvoices.reduce((a, i) => a + i.netOre, 0)
    : support.customers.reduce((a, c) => a + c.netOre, 0);
  const subscriptionOre = subsInvoices.reduce((a, i) => a + i.netOre, 0);
  const monthInvoices = [...subsInvoices, ...supportInvoices];
  const unpaid = monthInvoices.filter((i) => i.status !== 'paid');
  const totalGross = monthInvoices.reduce((a, i) => a + i.grossOre, 0);
  const outstandingGross = unpaid.reduce((a, i) => a + i.grossOre, 0);
  const overdueSince = unpaid
    .filter((i) => i.dueAt && i.dueAt < now)
    .map((i) => daysBetween(i.dueAt!, now));
  const entries = support.entries;
  const onCases = entries.filter((e) => e.caseId);
  // A sent month is reported from its invoices: they hold the registered and billed minutes.
  const fromInvoices = supportInvoices.length > 0 && support.customers.length === 0;
  const lineMinutes = (k: 'registeredMinutes' | 'billedMinutes') =>
    supportInvoices.reduce((a, i) => a + i.lines.reduce((b, l) => b + (l[k] ?? 0), 0), 0);
  const billable = fromInvoices
    ? lineMinutes('registeredMinutes')
    : onCases.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0);
  const nonBillable = onCases.filter((e) => !e.billable).reduce((a, e) => a + e.minutes, 0);
  const all = entries.reduce((a, e) => a + e.minutes, 0);
  const auto = entries.filter((e) => e.source === 'auto').reduce((a, e) => a + e.minutes, 0);
  const staff = new Map<
    string,
    { name: string; billable: number; nonBillable: number; cases: Set<string> }
  >();
  for (const e of entries) {
    const s = staff.get(e.staffUserId) ?? {
      name: e.staffName,
      billable: 0,
      nonBillable: 0,
      cases: new Set(),
    };
    if (e.billable && e.caseId) s.billable += e.minutes;
    else s.nonBillable += e.minutes;
    if (e.caseId) s.cases.add(e.caseId);
    staff.set(e.staffUserId, s);
  }
  const resolved = new Set(
    entries
      .filter((e) => e.caseId && e.caseResolvedAt && inMonth(e.caseResolvedAt, m))
      .map((e) => e.caseId!),
  );
  return {
    month: m,
    open,
    subscriptionOre,
    supportOre,
    revenueOre: subscriptionOre + supportOre,
    activeAtEnd: subs.filter(
      (s) =>
        s.createdAt < m.end && (!s.cancelAt || s.cancelAt >= m.end) && s.status !== 'incomplete',
    ).length,
    billableMinutes: billable,
    billedMinutes: fromInvoices
      ? lineMinutes('billedMinutes')
      : support.customers.reduce((a, c) => a + c.billed, 0),
    nonBillableMinutes: nonBillable,
    autoShare: pct(auto, all),
    outstandingGross,
    paidShare: pct(totalGross - outstandingGross, totalGross),
    oldestOverdueDays: overdueSince.length ? Math.max(...overdueSince) : 0,
    customersBilled: new Set(monthInvoices.map((i) => i.tenantId)).size,
    casesResolved: resolved.size,
    cancelled: subs.filter((s) => s.cancelAt && inMonth(s.cancelAt, m)).length,
    newSubs: subs.filter((s) => inMonth(s.createdAt, m)).length,
    topCustomers: (fromInvoices
      ? supportInvoices.map((i) => ({
          tenantId: i.tenantId,
          name: i.tenantName,
          billedMinutes: i.lines.reduce((b, l) => b + (l.billedMinutes ?? 0), 0),
          netOre: i.netOre,
        }))
      : support.customers.map((c) => ({
          tenantId: c.tenantId,
          name: c.tenantName,
          billedMinutes: c.billed,
          netOre: c.netOre,
        }))
    ).sort((a, b) => b.netOre - a.netOre),
    perStaff: [...staff.values()]
      .map((s) => ({
        name: s.name,
        billable: s.billable,
        nonBillable: s.nonBillable,
        cases: s.cases.size,
      }))
      .sort((a, b) => b.billable - a.billable),
  };
}
