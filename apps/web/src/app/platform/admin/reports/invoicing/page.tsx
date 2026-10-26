import { formatDate, formatNumber, type Locale } from '@agentor/i18n';
import { Banner, Card, EmptyState, KpiCard, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { CircleCheck, Clock, FileText, Hourglass } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ReportToolbar } from '@/components/platform/admin/report-toolbar';
import {
  CustomerChip,
  FilterChips,
  growthOf,
  money,
  monthShort,
} from '@/components/platform/finance/bits';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { invoiceStatusText } from '@/server/report-export';
import {
  INVOICE_FILTERS,
  filterInvoices,
  growthPct,
  invoicingReport,
  reportRange,
  type InvoiceFilter,
} from '@/server/reports';
import { InvoicingReportMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.reports');
  return { title: t('type.invoicing') };
}

const SHOWN = 100;

/**
 * Administration › Rapporter › Fakturering (A4): every invoice issued in the period with its
 * status and days to payment. Amounts incl. VAT. The export always holds every invoice in the
 * period; the chips only filter the page.
 */
export default async function InvoicingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; period?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const t = await getTranslations('platform.reports');
  const ft = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const { range, invalid } = reportRange('invoicing', sp);
  const r = await invoicingReport(actor, range, now);
  const filter: InvoiceFilter = INVOICE_FILTERS.find((f) => f === sp.status) ?? 'all';
  const rows = filterInvoices(r.rows, filter);
  const query = `from=${range.fromIso}&to=${range.toIso}`;
  const period = `${formatDate(range.from, locale)} – ${formatDate(new Date(range.to.getTime() - 1), locale)}`;
  const day = (d: Date | null) => (d ? formatDate(d, locale).replace(/ \d{4}$/, '') : '–');
  const paidShare = r.invoicedOre ? Math.round((r.paidOre / r.invoicedOre) * 100) : 0;
  const opt = <T,>(key: string, v: T | undefined) => (v === undefined ? {} : { [key]: v });
  const days = (n: number) => formatNumber(n, locale, n % 1 ? 1 : 0);

  const invoicedGrowth = growthOf(
    growthPct(r.invoicedOre, r.previous.invoicedOre),
    (x) => `${x} %`,
    locale,
  );

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('invoicing.intro')}
        actions={<ReportToolbar type="invoicing" range={range} custom={sp.period === 'custom'} />}
      />
      {invalid && <Banner tone="warn">{t('rangeInvalid')}</Banner>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          hero
          compact
          icon={FileText}
          label={t('invoicing.invoiced')}
          {...opt('growth', invoicedGrowth)}
          value={money(r.invoicedOre, locale)}
          footer={`${period} · ${t('invoicing.invoicedSub', { count: r.rows.length })}`}
        />
        <KpiCard
          compact
          icon={CircleCheck}
          label={t('invoicing.paid')}
          {...opt(
            'growth',
            paidShare !== r.previous.paidShare
              ? {
                  direction: paidShare > r.previous.paidShare ? 'up' : 'down',
                  tone: paidShare > r.previous.paidShare ? 'good' : 'bad',
                  text: t('points', { n: Math.abs(paidShare - r.previous.paidShare) }),
                }
              : undefined,
          )}
          value={money(r.paidOre, locale)}
          footer={t('invoicing.paidSub', { pct: paidShare })}
        />
        <KpiCard
          compact
          icon={Hourglass}
          iconTone={r.outstandingCount ? 'error' : 'muted'}
          label={t('invoicing.outstanding')}
          {...opt(
            'growth',
            r.outstandingCount !== r.previous.outstandingCount
              ? {
                  direction: r.outstandingCount > r.previous.outstandingCount ? 'up' : 'down',
                  tone: r.outstandingCount > r.previous.outstandingCount ? 'bad' : 'good',
                  text: t('invoicesShort', {
                    count: Math.abs(r.outstandingCount - r.previous.outstandingCount),
                  }),
                }
              : undefined,
          )}
          value={money(r.outstandingOre, locale)}
          footer={t('invoicing.outstandingSub', { cards: r.cardFailed, overdue: r.overdue })}
        />
        <KpiCard
          compact
          icon={Clock}
          label={t('invoicing.daysToPay')}
          value={
            r.avgDaysToPay === null ? '–' : t('invoicing.days', { days: days(r.avgDaysToPay) })
          }
          footer={
            r.medianDaysToPay === null
              ? t('invoicing.noPaid')
              : t('invoicing.daysSub', { median: days(r.medianDaysToPay) })
          }
        />
      </div>

      <FilterChips
        label={t('invoicing.filterLabel')}
        items={INVOICE_FILTERS.map((f) => ({
          href: `/platform/admin/reports/invoicing?${query}${f === 'all' ? '' : `&status=${f}`}`,
          label: t(`invoicing.filter.${f}`, { count: r.counts[f] }),
          active: f === filter,
        }))}
      />

      <Card padding="none" className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={FileText} title={t('invoicing.empty')}>
            {t('invoicing.emptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('invoicing.tableTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('invoicing.colNumber')}</Th>
                <Th>{t('invoicing.colCustomer')}</Th>
                <Th>{t('invoicing.colType')}</Th>
                <Th>{t('invoicing.colIssued')}</Th>
                <Th>{t('invoicing.colDue')}</Th>
                <Th>{t('invoicing.colPaid')}</Th>
                <Th numeric>{t('invoicing.colDays')}</Th>
                <Th numeric>{t('invoicing.colAmount')}</Th>
                <Th className="pr-5">{t('invoicing.colStatus')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((row) => {
                const i = row.invoice;
                const tone =
                  row.state === 'paid'
                    ? 'ok'
                    : row.state === 'awaiting'
                      ? 'info'
                      : row.state === 'retrying'
                        ? 'warn'
                        : 'error';
                return (
                  <Tr key={i.id}>
                    <Td className="pl-5 font-mono text-mono">{i.number ?? '–'}</Td>
                    <Td>
                      <CustomerChip name={i.tenantName} />
                    </Td>
                    <Td>{`${ft(`kind.${i.kind}`)} · ${monthShort(i.periodStart, locale)}`}</Td>
                    <Td>{day(row.issued)}</Td>
                    <Td>{day(i.dueAt)}</Td>
                    <Td>{day(i.paidAt)}</Td>
                    <Td numeric>{row.daysToPay === null ? '–' : row.daysToPay}</Td>
                    <Td numeric className="font-semibold">
                      {money(i.grossOre, locale)}
                    </Td>
                    <Td className="pr-5">
                      <StatusPill status={tone}>
                        {invoiceStatusText(row, ft, locale, now)}
                      </StatusPill>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="m-0 border-t border-border px-5 py-3 text-meta text-fg-2">
          {t('invoicing.footer', { shown: Math.min(SHOWN, rows.length), total: r.rows.length })}
        </p>
      </Card>
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <InvoicingReportMobile
          r={r}
          rows={rows}
          filter={filter}
          range={range}
          query={query}
          custom={sp.period === 'custom'}
          invoicedGrowth={invoicedGrowth}
          now={now}
        />
      }
    />
  );
}
