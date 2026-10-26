import type { StaffActor } from '@agentor/db';
import { copenhagenToday } from './date-range';
import {
  financeInvoicesAll,
  monthReport,
  subscriptionRows,
  supportForMonth,
  type Month,
} from './finance-data';

/**
 * CSV exports for Finans (F2, F3, F6, F7): semicolon-separated with a BOM so Excel opens Danish
 * text right. Cells that start like a formula are prefixed, so a customer name can never run as
 * a formula in a spreadsheet.
 */

const cell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const kr = (ore: number) => (ore / 100).toFixed(2).replace('.', ',');
/** The Copenhagen calendar date (UTC would put midnight here on the day before). */
const day = (d: Date | null) => (d ? copenhagenToday(d) : '');

export function csv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function subscriptionsCsv(actor: StaffActor): Promise<string> {
  const rows = await subscriptionRows(actor);
  return csv([
    [
      'Kunde',
      'CVR',
      'Plan',
      'Interval',
      'Pris ekskl. moms',
      'Rabat %',
      'Periode start',
      'Periode slut',
      'Næste opkrævning',
      'Betalingsmetode',
      'Status',
    ],
    ...rows.map((s) => [
      s.tenantName,
      s.cvr,
      s.planName,
      s.interval === 'year' ? 'Årlig' : 'Månedlig',
      kr(s.priceOre),
      s.discountPct ?? '',
      day(s.currentPeriodStart),
      day(s.currentPeriodEnd),
      day(s.nextChargeAt),
      s.paymentMethod === 'invoice'
        ? `Faktura${s.ean ? ` EAN ${s.ean}` : ''}`
        : s.paymentMethod === 'mobilepay'
          ? 'MobilePay'
          : `Kort ${s.cardLast4 ?? ''}`.trim(),
      s.state,
    ]),
  ]);
}

/** "Eksportér til bogføring" (F6): every invoice in the period with net, VAT and status. */
export async function invoicesCsv(actor: StaffActor, m?: Month): Promise<string> {
  const all = await financeInvoicesAll(actor);
  const list = all
    .filter((i) => i.status !== 'draft')
    .filter(
      (i) => !m || ((i.issuedAt ?? i.createdAt) >= m.start && (i.issuedAt ?? i.createdAt) < m.end),
    )
    .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''));
  return csv([
    [
      'Nummer',
      'Kunde',
      'CVR',
      'Type',
      'Beskrivelse',
      'Udstedt',
      'Forfald',
      'Betalt',
      'Netto',
      'Moms',
      'I alt',
      'Betaling',
      'Status',
    ],
    ...list.map((i) => [
      i.number,
      i.tenantName,
      i.cvr,
      i.kind === 'support' ? 'Support' : 'Abonnement',
      i.description,
      day(i.issuedAt),
      day(i.dueAt),
      day(i.paidAt),
      kr(i.netOre),
      kr(i.vatOre),
      kr(i.grossOre),
      i.paymentMethod,
      i.status,
    ]),
  ]);
}

/** "Eksportér tidslog" (F3): one line per registration, with the billed (rounded) time. */
export async function timelogCsv(actor: StaffActor, m: Month): Promise<string> {
  const { customers } = await supportForMonth(actor, m);
  const rows: unknown[][] = [
    [
      'Kunde',
      'Sag',
      'Dato',
      'Support Agent',
      'Kilde',
      'Registreret min.',
      'Afregnet min.',
      'Fakturerbar',
    ],
  ];
  for (const c of customers)
    for (const e of c.entries.sort((a, b) => a.workDate.localeCompare(b.workDate)))
      rows.push([
        c.tenantName,
        e.caseNumber ? `#${e.caseNumber} ${e.caseTitle ?? ''}` : '',
        e.workDate,
        e.staffName,
        e.source,
        e.minutes,
        e.billable && e.caseId ? Math.ceil(e.minutes / 15) * 15 : 0,
        e.billable && e.caseId ? 'ja' : 'nej',
      ]);
  return csv(rows);
}

/** The monthly report (F7) as CSV; amounts ex. VAT. */
/**
 * F7 Omsætning as CSV (Administration › Rapporter): ISO month, a dot as decimal point and minutes
 * as whole numbers, so a spreadsheet reads it in any locale (PLAN-2026-10-21 §6).
 */
export async function reportCsv(actor: StaffActor, m: Month): Promise<string> {
  const kr = (ore: number) => (ore / 100).toFixed(2);
  const r = await monthReport(actor, m);
  return csv([
    ['Måned', m.key],
    ['Omsætning ekskl. moms', kr(r.revenueOre)],
    ['Abonnementer', kr(r.subscriptionOre)],
    ['Support', kr(r.supportOre)],
    ['Aktive abonnementer ultimo', r.activeAtEnd],
    ['Fakturerbar tid (min.)', r.billableMinutes],
    ['Afregnet tid (min.)', r.billedMinutes],
    ['Ikke fakturerbar (min.)', r.nonBillableMinutes],
    ['Udestående inkl. moms', kr(r.outstandingGross)],
    ['Sager løst', r.casesResolved],
    [],
    ['Kunde', 'Afregnet min.', 'Beløb ekskl. moms'],
    ...r.topCustomers.map((c) => [c.name, c.billedMinutes, kr(c.netOre)]),
    [],
    ['Support Agent', 'Fakturerbar min.', 'Ikke fakturerbar min.', 'Sager'],
    ...r.perStaff.map((s) => [s.name, s.billable, s.nonBillable, s.cases]),
  ]);
}
