import { formatDate, formatNumber, type Locale } from '@agentor/i18n';
import { StatusPill, type Growth } from '@agentor/ui';
import {
  ChipGroup,
  ExpandCard,
  KV,
  MobileCard,
  MobileEmpty,
  MobileFootnote,
  MobileShell,
  TrendPill,
} from '@agentor/ui/mobile';
import { FileText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { ReportMobileExports, ReportMobileHead } from '@/components/platform/admin/report-toolbar';
import { money, monthShort } from '@/components/platform/finance/bits';
import type { DateRange } from '@/server/date-range';
import { invoiceStatusText } from '@/server/report-export';
import type { InvoiceFilter, InvoiceReportRow, InvoicingReport } from '@/server/reports';

const SHOWN = 50;
/** The chips drawn on MP28; Abonnement and Support stay on desktop. */
const CHIPS: InvoiceFilter[] = ['all', 'outstanding', 'paid'];

/**
 * MP28 Rapporter › Fakturering: invoiced and days to payment for the Fra/til period, then the
 * invoices as folding cards with their status. Same rows as A4; the export holds them all.
 */
export async function InvoicingReportMobile({
  r,
  rows,
  filter,
  range,
  query,
  invoicedGrowth,
  now,
}: {
  r: InvoicingReport;
  rows: InvoiceReportRow[];
  filter: InvoiceFilter;
  range: DateRange;
  query: string;
  invoicedGrowth: Growth | undefined;
  now: Date;
}) {
  const t = await getTranslations('platform.reports');
  const ft = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const day = (d: Date | null) => (d ? formatDate(d, locale).replace(/ \d{4}$/, '') : null);
  const days = (n: number) => formatNumber(n, locale, n % 1 ? 1 : 0);
  const chipFilter = CHIPS.includes(filter) ? filter : 'all';
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <ReportMobileHead type="invoicing" range={range} query={query} />
      <div className="grid grid-cols-2 gap-3">
        <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
          <span className="flex items-center justify-between gap-1.5 overflow-hidden whitespace-nowrap">
            <span className="truncate text-meta font-medium text-fg-2">
              {t('invoicing.invoiced')}
            </span>
            {invoicedGrowth && <TrendPill growth={invoicedGrowth} />}
          </span>
          <strong className="truncate text-m-kpi tabular">{money(r.invoicedOre, locale)}</strong>
          <span className="truncate text-micro text-fg-2">
            {t('invoicing.invoicedSub', { count: r.rows.length })}
          </span>
        </MobileCard>
        <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
          <span className="truncate text-meta font-medium text-fg-2">
            {t('invoicing.daysToPay')}
          </span>
          <strong className="text-m-kpi tabular">
            {r.avgDaysToPay === null ? '–' : t('invoicing.days', { days: days(r.avgDaysToPay) })}
          </strong>
          <span className="truncate text-micro text-fg-2">
            {r.medianDaysToPay === null
              ? t('invoicing.noPaid')
              : t('invoicing.medianShort', { median: days(r.medianDaysToPay) })}
          </span>
        </MobileCard>
      </div>
      <ChipGroup
        label={t('invoicing.filterLabel')}
        linkAs={Link}
        value={chipFilter}
        items={CHIPS.map((f) => ({
          key: f,
          label: t(`invoicing.chip.${f}` as 'invoicing.chip.all', { count: r.counts[f] }),
          href: `/platform/admin/reports/invoicing?${query}${f === 'all' ? '' : `&status=${f}`}`,
        }))}
      />
      {rows.length === 0 ? (
        <MobileEmpty icon={FileText} title={t('invoicing.empty')} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.slice(0, SHOWN).map((row) => {
            const i = row.invoice;
            const kind = `${ft(`kind.${i.kind}`)} · ${monthShort(i.periodStart, locale)}`;
            const tone =
              row.state === 'paid'
                ? 'ok'
                : row.state === 'awaiting'
                  ? 'info'
                  : row.state === 'retrying'
                    ? 'warn'
                    : 'error';
            return (
              <ExpandCard
                key={i.id}
                title={`${i.number ?? '–'} · ${i.tenantName}`}
                meta={`${kind} · ${money(i.grossOre, locale)}`}
                trailing={
                  <StatusPill status={tone}>{invoiceStatusText(row, ft, locale, now)}</StatusPill>
                }
              >
                <KV k={t('invoicing.colType')}>{kind}</KV>
                <KV k={t('invoicing.colIssued')}>{day(row.issued) ?? '–'}</KV>
                <KV k={t('invoicing.colPaid')}>{day(i.paidAt) ?? t('invoicing.notPaid')}</KV>
                <KV k={t('invoicing.colDays')}>
                  {row.daysToPay !== null
                    ? row.daysToPay
                    : i.dueAt
                      ? t('invoicing.due', { date: day(i.dueAt)! })
                      : '–'}
                </KV>
                <KV k={t('invoicing.colAmount')}>
                  <strong className="tabular">{money(i.grossOre, locale)}</strong>
                </KV>
              </ExpandCard>
            );
          })}
        </div>
      )}
      <MobileFootnote>
        {t('invoicing.footer', { shown: Math.min(SHOWN, rows.length), total: r.rows.length })}
      </MobileFootnote>
      <ReportMobileExports type="invoicing" query={query} />
    </MobileShell>
  );
}
