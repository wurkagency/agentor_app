import { formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileShell,
  RowIcon,
  TrendPill,
} from '@agentor/ui/mobile';
import { CalendarDays, Download } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { ReportMobileHead } from '@/components/platform/admin/report-toolbar';
import { growthOf, kr, monthLong, monthYear } from '@/components/platform/finance/bits';
import { MobileSendReport } from '@/components/platform/finance/mobile-actions';
import { NameValue } from '@/components/platform/finance/mobile-bits';
import { growthPct, monthQuery, monthRange, pct, type MonthReport } from '@/server/finance-data';

export interface ReportsMobileData {
  /** Newest first, each with the month before it for the trend. */
  months: { r: MonthReport; before: MonthReport }[];
  /** The month folded out, and the one the customer and supporter lists are for. */
  selected: MonthReport;
}

/** MP23 Rapporter (F7): one foldable row per month, the largest customers and time per supporter. */
export async function ReportsMobile({ d }: { d: ReportsMobileData }) {
  const t = await getTranslations('mobile.reports');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const krs = (ore: number) => `${kr(ore, locale)} kr.`;
  const fm = (min: number) => formatMinutes(min, locale);
  const s = d.selected;
  const supportTotal = s.topCustomers.reduce((a, c) => a + c.netOre, 0);
  const selectedName = monthLong(s.month.start, locale);
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <ReportMobileHead type="revenue" query={monthQuery(s.month)} range={monthRange(s.month)} />
      {d.months.map(({ r, before }) => {
        const growth = growthOf(
          growthPct(r.revenueOre, before.revenueOre),
          (x) => `${x} %`,
          locale,
        );
        return (
          <ExpandCard
            key={r.month.key}
            open={r.month.key === s.month.key}
            leading={<RowIcon icon={CalendarDays} />}
            title={monthYear(r.month.start, locale)}
            meta={
              r.open ? tf('report.preliminary') : `${krs(r.revenueOre)} · ${fm(r.billedMinutes)}`
            }
            trailing={
              r.open ? (
                <StatusPill status="info">{tf('report.open')}</StatusPill>
              ) : (
                <StatusPill status="ok">
                  {r.paidShare >= 99.5
                    ? tf('state.paid')
                    : tf('report.paidPct', { pct: formatNumber(r.paidShare, locale) })}
                </StatusPill>
              )
            }
          >
            <KV k={tf('report.revenue')}>
              <span className="inline-flex items-center gap-1.5">
                <strong className="tabular">{krs(r.revenueOre)}</strong>
                {growth && <TrendPill growth={growth} />}
              </span>
            </KV>
            <KV k={tf('kpi.subscriptions')}>
              {t('subscriptions', { amount: krs(r.subscriptionOre), count: r.activeAtEnd })}
            </KV>
            <KV k={tf('kind.support')}>
              {krs(r.supportOre)} · {fm(r.billedMinutes)}
            </KV>
            <KV k={tf('billing.rate')}>
              {tf('report.rateDetail', {
                billable: fm(r.billableMinutes),
                not: fm(r.nonBillableMinutes),
              })}
            </KV>
            <KV k={t('avgPerCustomer')}>{krs(r.revenueOre / Math.max(1, r.customersBilled))}</KV>
            <KV k={tf('report.effectiveRate')}>
              {r.billableMinutes ? krs((r.supportOre / r.billableMinutes) * 60) : '–'}
            </KV>
            <KV k={tf('kpi.churn')}>
              {formatNumber(pct(r.cancelled, Math.max(1, r.activeAtEnd)), locale, 1)} % ·{' '}
              {tf('report.churnDetail', { cancelled: r.cancelled, created: r.newSubs })}
            </KV>
            <KV k={tf('report.casesResolved')}>{formatNumber(r.casesResolved, locale)}</KV>
            <KV k={tf('report.autoLogged')}>{formatNumber(r.autoShare, locale)} %</KV>
            <CardActions>
              <CardButton
                href={`/platform/admin/reports/revenue/export.csv?${monthQuery(r.month)}`}
                icon={Download}
              >
                CSV
              </CardButton>
              <CardButton
                href={`/platform/admin/reports/revenue/export.pdf?${monthQuery(r.month)}`}
                icon={Download}
              >
                PDF
              </CardButton>
              <MobileSendReport month={r.month.key} label={tf('report.sendBookkeeper')} />
            </CardActions>
          </ExpandCard>
        );
      })}
      <ExpandCard title={tf('report.topCustomers')} meta={t('topMeta', { month: selectedName })}>
        {s.topCustomers.length === 0 ? (
          <p className="m-0 pt-2 text-table text-fg-2">{tf('noSupport')}</p>
        ) : (
          s.topCustomers.slice(0, 5).map((c) => (
            <NameValue key={c.tenantId} name={c.name}>
              {fm(c.billedMinutes)} · {krs(c.netOre)} ·{' '}
              {formatNumber(pct(c.netOre, supportTotal), locale)} %
            </NameValue>
          ))
        )}
      </ExpandCard>
      <ExpandCard
        title={tf('report.perStaff')}
        meta={t('staffMeta', {
          month: selectedName,
          pct: formatNumber(s.autoShare, locale),
        })}
      >
        {s.perStaff.length === 0 ? (
          <p className="m-0 pt-2 text-table text-fg-2">{t('noTime')}</p>
        ) : (
          s.perStaff.map((x) => (
            <NameValue key={x.name} name={x.name}>
              {fm(x.billable)} · {tf('billing.casesCount', { count: x.cases })}
            </NameValue>
          ))
        )}
      </ExpandCard>
    </MobileShell>
  );
}
