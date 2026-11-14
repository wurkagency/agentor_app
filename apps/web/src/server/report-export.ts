import { logExport, type StaffActor } from '@agentor/db';
import { formatDate, formatMinutes, formatMoney, type Locale } from '@agentor/i18n';
import { getTranslations } from 'next-intl/server';
import { copenhagenToday, type DateRange } from './date-range';
import { csv } from './finance-export';
import { daysBetween } from './finance-data';
import { db } from './infra';
import { reportPdf } from './report-pdf';
import {
  invoicingReport,
  supportReport,
  type InvoiceReportRow,
  type InvoicingReport,
  type SupportReport,
} from './reports';

/**
 * PDF and CSV for Administration › Rapporter (A3, A4; F7 has its own month report). Generated on
 * the server from the same rows as the page and streamed as a download. The PDF uses Danish number
 * and date formats; the CSV ISO dates and a dot as decimal point, with a header row. Every export
 * is written to the platform audit log.
 */

type FinanceT = Awaited<ReturnType<typeof getTranslations<'platform.finance'>>>;

/** "Betalt · kort", "Forfalden 10 dage", … as on F6 and A4. */
export function invoiceStatusText(
  r: InvoiceReportRow,
  t: FinanceT,
  locale: Locale,
  now = new Date(),
) {
  const i = r.invoice;
  switch (r.state) {
    case 'paid':
      return t('state.paidBy', {
        method: i.paymentMethod === 'invoice' ? t('method.ean') : t(`method.${i.paymentMethod}`),
      });
    case 'retrying':
      return t('state.retrying', {
        date: formatDate(i.nextRetryAt!, locale).replace(/ \d{4}$/, ''),
      });
    case 'card_failed':
      return t('state.cardRefused', { count: i.attempts });
    case 'reminded':
      return t('state.reminded', { count: i.reminders });
    case 'overdue':
      return t('state.overdueDays', { days: daysBetween(i.dueAt!, now) });
    default:
      return t('state.awaiting');
  }
}

const MONTH_SHORT = new Intl.DateTimeFormat('da-DK', {
  month: 'short',
  timeZone: 'Europe/Copenhagen',
});
/** The Copenhagen calendar date, YYYY-MM-DD (not UTC: 1 Oct 00:00 here is 30 Sep in UTC). */
const iso = (d: Date | null) => (d ? copenhagenToday(d) : '');
const dot = (ore: number) => (ore / 100).toFixed(2);
const fileName = (type: string, r: DateRange, ext: string) =>
  `agentor-${type}-${r.fromIso}-${r.toIso}.${ext}`;

function download(body: Buffer | string, name: string, type: string): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/* ---- Support og tid (A3) ------------------------------------------------------------------------- */

export function supportCsv(r: SupportReport, category: (k: string) => string): string {
  return csv([
    [
      'afsnit',
      'navn',
      'fakturerbar_min',
      'ikke_fakturerbar_min',
      'sager',
      'afregnet_min',
      'beloeb_ekskl_moms',
      'andel_pct',
    ],
    [
      'i_alt',
      `${r.range.fromIso}..${r.range.toIso}`,
      r.registeredMinutes,
      r.nonBillableMinutes,
      r.casesResolved,
      r.billedMinutes,
      dot(r.netOre),
      100,
    ],
    ...r.perStaff.map((s) => [
      'supporter',
      s.name,
      s.billable,
      s.nonBillable,
      s.cases,
      '',
      '',
      s.autoShare,
    ]),
    ...r.perCategory.map((c) => [
      'kategori',
      category(c.category),
      c.minutes,
      '',
      c.cases,
      '',
      '',
      c.share,
    ]),
    ...r.topCustomers.map((c) => [
      'kunde',
      c.name,
      '',
      '',
      c.cases,
      c.billedMinutes,
      dot(c.netOre),
      c.share,
    ]),
  ]);
}

async function supportPdf(r: SupportReport): Promise<Buffer> {
  const t = await getTranslations({ locale: 'da', namespace: 'platform.reports' });
  const tc = await getTranslations({ locale: 'da', namespace: 'platform.case' });
  const m = (n: number) => formatMinutes(n, 'da');
  const kr = (ore: number) => formatMoney(ore / 100, 'da');
  return reportPdf({
    title: t('pdfSupportTitle'),
    subtitle: t('pdfPeriod', {
      from: formatDate(r.range.from, 'da'),
      to: formatDate(new Date(r.range.to.getTime() - 1), 'da'),
    }),
    kpis: [
      { label: t('support.registered'), value: m(r.registeredMinutes), sub: t('support.billable') },
      {
        label: t('support.billed'),
        value: m(r.billedMinutes),
        sub: t('support.rounding', {
          time: m(r.billedMinutes - r.registeredMinutes),
          pct: r.registeredMinutes
            ? Math.round(((r.billedMinutes - r.registeredMinutes) / r.registeredMinutes) * 100)
            : 0,
        }),
      },
      {
        label: t('support.nonBillable'),
        value: m(r.nonBillableMinutes),
        sub: t('support.nonBillableSub'),
      },
      {
        label: t('support.resolved'),
        value: String(r.casesResolved),
        sub:
          r.medianResolvedMinutes === null
            ? t('support.customers', { count: r.customersResolved })
            : t('support.resolvedSub', {
                count: r.customersResolved,
                time: m(r.medianResolvedMinutes),
              }),
      },
    ],
    tables: [
      {
        heading: t('support.perStaff'),
        columns: [
          { label: t('support.colStaff'), weight: 3 },
          { label: t('support.colBillable'), weight: 2, align: 'right' },
          { label: t('support.colNonBillable'), weight: 2, align: 'right' },
          { label: t('support.colCases'), weight: 1, align: 'right' },
          { label: t('support.colAuto'), weight: 1.4, align: 'right' },
        ],
        rows: r.perStaff.map((s) => [
          s.name,
          m(s.billable),
          m(s.nonBillable),
          String(s.cases),
          `${s.autoShare} %`,
        ]),
        total: [
          t('total'),
          m(r.perStaff.reduce((a, s) => a + s.billable, 0)),
          m(r.perStaff.reduce((a, s) => a + s.nonBillable, 0)),
          String(r.perStaff.reduce((a, s) => a + s.cases, 0)),
          `${r.autoShare} %`,
        ],
      },
      {
        heading: t('support.perCategory'),
        columns: [
          { label: t('support.colCategory'), weight: 3 },
          { label: t('support.colTime'), weight: 2, align: 'right' },
          { label: t('support.colCases'), weight: 1, align: 'right' },
          { label: t('support.colShare'), weight: 1, align: 'right' },
        ],
        rows: r.perCategory.map((c) => [
          tc(`category.${c.category}` as 'category.error'),
          m(c.minutes),
          String(c.cases),
          `${c.share} %`,
        ]),
      },
      {
        heading: t('support.topCustomers'),
        columns: [
          { label: t('support.colCustomer'), weight: 3 },
          { label: t('support.colCases'), weight: 1, align: 'right' },
          { label: t('support.colBilled'), weight: 1.5, align: 'right' },
          { label: t('support.colAmount'), weight: 2, align: 'right' },
          { label: t('support.colShare'), weight: 1, align: 'right' },
        ],
        rows: r.topCustomers.map((c) => [
          c.name,
          String(c.cases),
          m(c.billedMinutes),
          kr(c.netOre),
          `${c.share} %`,
        ]),
      },
    ],
    pageLabel: (p, n) => t('pdfPage', { page: p, pages: n }),
    footer: t('pdfFooterExVat'),
  });
}

/* ---- Fakturering (A4) ---------------------------------------------------------------------------- */

export function invoicingCsv(r: InvoicingReport, ft: FinanceT): string {
  return csv([
    [
      'nummer',
      'kunde',
      'cvr',
      'type',
      'periode',
      'udstedt',
      'forfald',
      'betalt',
      'dage_til_betaling',
      'beloeb_inkl_moms',
      'status',
      'betalingsmetode',
    ],
    ...r.rows.map((row) => {
      const i = row.invoice;
      return [
        i.number ?? '',
        i.tenantName,
        i.cvr ?? '',
        i.kind,
        iso(i.periodStart).slice(0, 7),
        iso(row.issued),
        iso(i.dueAt),
        iso(i.paidAt),
        row.daysToPay ?? '',
        dot(i.grossOre),
        invoiceStatusText(row, ft, 'da'),
        i.paymentMethod,
      ];
    }),
  ]);
}

async function invoicingPdf(r: InvoicingReport): Promise<Buffer> {
  const t = await getTranslations({ locale: 'da', namespace: 'platform.reports' });
  const ft = await getTranslations({ locale: 'da', namespace: 'platform.finance' });
  const kr = (ore: number) => formatMoney(ore / 100, 'da');
  const day = (d: Date | null) => (d ? formatDate(d, 'da') : '–');
  const days = (n: number | null) => (n === null ? '–' : String(n).replace('.', ','));
  return reportPdf({
    title: t('pdfInvoicingTitle'),
    subtitle: t('pdfPeriod', {
      from: formatDate(r.range.from, 'da'),
      to: formatDate(new Date(r.range.to.getTime() - 1), 'da'),
    }),
    kpis: [
      {
        label: t('invoicing.invoiced'),
        value: kr(r.invoicedOre),
        sub: t('invoicing.invoicedSub', { count: r.rows.length }),
      },
      {
        label: t('invoicing.paid'),
        value: kr(r.paidOre),
        sub: t('invoicing.paidSub', {
          pct: r.invoicedOre ? Math.round((r.paidOre / r.invoicedOre) * 100) : 0,
        }),
      },
      {
        label: t('invoicing.outstanding'),
        value: kr(r.outstandingOre),
        sub: t('invoicing.outstandingSub', { cards: r.cardFailed, overdue: r.overdue }),
      },
      {
        label: t('invoicing.daysToPay'),
        value: r.avgDaysToPay === null ? '–' : t('invoicing.days', { days: days(r.avgDaysToPay) }),
        sub:
          r.medianDaysToPay === null
            ? undefined
            : t('invoicing.daysSub', { median: days(r.medianDaysToPay) }),
      },
    ],
    tables: [
      {
        heading: t('invoicing.tableTitle'),
        columns: [
          { label: t('invoicing.colNumber'), weight: 2 },
          { label: t('invoicing.colCustomer'), weight: 2.5 },
          { label: t('invoicing.colType'), weight: 1.7 },
          { label: t('invoicing.colIssued'), weight: 1.25 },
          { label: t('invoicing.colDue'), weight: 1.25 },
          { label: t('invoicing.colPaid'), weight: 1.25 },
          { label: t('invoicing.colDays'), weight: 0.6, align: 'right' },
          { label: t('invoicing.colAmount'), weight: 1.7, align: 'right' },
          { label: t('invoicing.colStatus'), weight: 2.2 },
        ],
        rows: r.rows.map((row) => {
          const i = row.invoice;
          return [
            i.number ?? '–',
            i.tenantName,
            `${ft(`kind.${i.kind}`)} · ${MONTH_SHORT.format(i.periodStart)}`,
            day(row.issued),
            day(i.dueAt),
            day(i.paidAt),
            row.daysToPay === null ? '–' : String(row.daysToPay),
            kr(i.grossOre),
            invoiceStatusText(row, ft, 'da'),
          ];
        }),
        total: [t('total'), '', '', '', '', '', '', kr(r.invoicedOre), ''],
        size: 8,
      },
    ],
    pageLabel: (p, n) => t('pdfPage', { page: p, pages: n }),
    footer: t('pdfFooterInclVat'),
  });
}

/** Builds, audit-logs and streams one export. */
export async function reportExport(
  actor: StaffActor,
  type: 'support' | 'invoicing',
  format: 'csv' | 'pdf',
  range: DateRange,
): Promise<Response> {
  if (type === 'support') {
    const r = await supportReport(actor, range);
    const tc = await getTranslations({ locale: 'da', namespace: 'platform.case' });
    const body =
      format === 'csv'
        ? supportCsv(r, (k) => tc(`category.${k}` as 'category.error'))
        : await supportPdf(r);
    await logExport(db(), actor, {
      report: type,
      format,
      from: range.fromIso,
      to: range.toIso,
      rows: r.perStaff.length + r.perCategory.length + r.topCustomers.length,
    });
    return download(
      body,
      fileName('support', range, format),
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    );
  }
  const r = await invoicingReport(actor, range);
  const ft = await getTranslations({ locale: 'da', namespace: 'platform.finance' });
  const body = format === 'csv' ? invoicingCsv(r, ft) : await invoicingPdf(r);
  await logExport(db(), actor, {
    report: type,
    format,
    from: range.fromIso,
    to: range.toIso,
    rows: r.rows.length,
  });
  return download(
    body,
    fileName('fakturering', range, format),
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
  );
}
