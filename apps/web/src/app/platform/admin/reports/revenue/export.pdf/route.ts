import { logExport } from '@agentor/db';
import { formatMinutes, formatMoney } from '@agentor/i18n';
import { getTranslations } from 'next-intl/server';
import type { NextRequest } from 'next/server';
import { monthYear } from '@/components/platform/finance/bits';
import { currentMonth, monthFromQuery, monthReport, shiftMonth } from '@/server/finance-data';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { reportPdf } from '@/server/report-pdf';

/** "PDF" (F7, Administration › Rapporter › Omsætning): the monthly report, amounts ex. VAT. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const sp = req.nextUrl.searchParams;
  const m =
    monthFromQuery({ from: sp.get('from'), month: sp.get('month') }) ??
    shiftMonth(currentMonth(), -1);
  const r = await monthReport(actor, m);
  const t = await getTranslations({ locale: 'da', namespace: 'platform.reports' });
  const kr = (ore: number) => formatMoney(ore / 100, 'da');
  const min = (n: number) => formatMinutes(n, 'da');
  const pdf = reportPdf({
    title: t('pdfRevenueTitle', { month: monthYear(m.start, 'da') }),
    subtitle: t('pdfFooterExVat'),
    kpis: [
      { label: t('revenue.total'), value: kr(r.revenueOre) },
      {
        label: t('revenue.subscriptions'),
        value: kr(r.subscriptionOre),
        sub: t('revenue.active', { count: r.activeAtEnd }),
      },
      { label: t('revenue.support'), value: kr(r.supportOre) },
      {
        label: t('revenue.outstanding'),
        value: kr(r.outstandingGross),
        sub: t('revenue.outstandingSub'),
      },
      { label: t('support.registered'), value: min(r.billableMinutes) },
      { label: t('support.billed'), value: min(r.billedMinutes) },
      { label: t('support.nonBillable'), value: min(r.nonBillableMinutes) },
      { label: t('support.resolved'), value: String(r.casesResolved) },
    ],
    tables: [
      {
        heading: t('support.topCustomers'),
        columns: [
          { label: t('support.colCustomer'), weight: 3 },
          { label: t('support.colBilled'), weight: 1.5, align: 'right' },
          { label: t('support.colAmount'), weight: 2, align: 'right' },
        ],
        rows: r.topCustomers.map((c) => [c.name, min(c.billedMinutes), kr(c.netOre)]),
      },
      {
        heading: t('support.perStaff'),
        columns: [
          { label: t('support.colStaff'), weight: 3 },
          { label: t('support.colBillable'), weight: 2, align: 'right' },
          { label: t('support.colNonBillable'), weight: 2, align: 'right' },
          { label: t('support.colCases'), weight: 1, align: 'right' },
        ],
        rows: r.perStaff.map((s) => [s.name, min(s.billable), min(s.nonBillable), String(s.cases)]),
      },
    ],
    pageLabel: (p, n) => t('pdfPage', { page: p, pages: n }),
    footer: t('pdfFooterExVat'),
  });
  await logExport(db(), actor, {
    report: 'revenue',
    format: 'pdf',
    from: m.firstDay,
    to: m.lastDay,
    rows: r.topCustomers.length + r.perStaff.length,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="agentor-omsaetning-${m.key}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
