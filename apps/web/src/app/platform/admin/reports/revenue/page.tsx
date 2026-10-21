import { formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
import {
  Card,
  Gauge,
  HeroCurve,
  Icon,
  KpiCard,
  MiniBars,
  SegmentBar,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@agentor/ui';
import { CircleCheck, Clock, Download, FileText, Headphones, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Responsive } from '@agentor/ui/mobile';
import { ButtonLink } from '@/components/button-link';
import { SendReportButton } from '@/components/platform/finance/action-buttons';
import {
  PanelHeader,
  dayMonth,
  growthOf,
  kr,
  monthLong,
  monthShort,
  monthYear,
} from '@/components/platform/finance/bits';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import {
  currentMonth,
  growthPct,
  monthReport,
  monthsBack,
  monthFromQuery,
  monthQuery,
  pct,
  shiftMonth,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { ReportsMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance');
  return { title: t('report.title') };
}

/** Administration › Rapporter › Omsætning (F7): the monthly report, ex. VAT, with the last six months. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  // The last closed month by default, as the boards show.
  const m = monthFromQuery(sp, now) ?? shiftMonth(cur, -1);
  const list = monthsBack(cur, 6).reverse();
  const history = monthsBack(m, 6);
  const [reports, r, before, past, oldest] = await Promise.all([
    Promise.all(list.map((mm) => monthReport(actor, mm, now))),
    monthReport(actor, m, now),
    monthReport(actor, shiftMonth(m, -1), now),
    Promise.all(history.map((mm) => monthReport(actor, mm, now))),
    // MP23: the trend on the oldest month in the list needs the month before it.
    monthReport(actor, shiftMonth(list.at(-1)!, -1), now),
  ]);
  const prevName = monthLong(shiftMonth(m, -1).start, locale);
  const g = (a: number, b: number, goodUp = true) =>
    growthOf(growthPct(a, b), (x) => `${x} %`, locale, goodUp);
  const supportShare = (x: number) =>
    pct(
      x,
      r.topCustomers.reduce((a, c) => a + c.netOre, 0),
    );
  const staffTotal = r.perStaff.reduce(
    (a, s) => ({
      billable: a.billable + s.billable,
      nonBillable: a.nonBillable + s.nonBillable,
      cases: a.cases + s.cases,
    }),
    { billable: 0, nonBillable: 0, cases: 0 },
  );
  const stats: { label: string; value: string; growth?: ReturnType<typeof g>; detail: string }[] = [
    {
      label: t('report.avgPerCustomer'),
      value: `${kr(r.revenueOre / Math.max(1, r.customersBilled), locale)} kr.`,
      growth: g(
        r.revenueOre / Math.max(1, r.customersBilled),
        before.revenueOre / Math.max(1, before.customersBilled),
      ),
      detail: t('report.avgDetail', {
        subs: kr(r.subscriptionOre / Math.max(1, r.activeAtEnd), locale),
        support: kr(r.supportOre / Math.max(1, r.topCustomers.length), locale),
      }),
    },
    {
      label: t('report.effectiveRate'),
      value: r.billableMinutes ? `${kr((r.supportOre / r.billableMinutes) * 60, locale)} kr.` : '–',
      growth:
        r.billableMinutes && before.billableMinutes
          ? g(r.supportOre / r.billableMinutes, before.supportOre / before.billableMinutes)
          : undefined,
      detail: t('report.effectiveDetail'),
    },
    {
      label: t('kpi.churn'),
      value: `${formatNumber(pct(r.cancelled, Math.max(1, r.activeAtEnd)), locale, 1)} %`,
      growth: g(pct(r.cancelled, r.activeAtEnd), pct(before.cancelled, before.activeAtEnd), false),
      detail: t('report.churnDetail', { cancelled: r.cancelled, created: r.newSubs }),
    },
    {
      label: t('report.casesResolved'),
      value: formatNumber(r.casesResolved, locale),
      growth: g(r.casesResolved, before.casesResolved),
      detail: t('report.casesDetail', { customers: r.topCustomers.length }),
    },
    {
      label: t('billing.registered'),
      value: formatMinutes(r.billableMinutes, locale),
      growth: g(r.billableMinutes, before.billableMinutes),
      detail: t('report.billableTime'),
    },
    {
      label: t('report.billedTime'),
      value: formatMinutes(r.billedMinutes, locale),
      growth: g(r.billedMinutes, before.billedMinutes),
      detail: t('report.roundingDetail', {
        time: formatMinutes(r.billedMinutes - r.billableMinutes, locale),
        pct: formatNumber(pct(r.billedMinutes - r.billableMinutes, r.billableMinutes), locale),
      }),
    },
    {
      label: t('report.notBillable'),
      value: formatMinutes(r.nonBillableMinutes, locale),
      growth: g(r.nonBillableMinutes, before.nonBillableMinutes, false),
      detail: t('billing.notBillableLegend'),
    },
    {
      label: t('report.autoLogged'),
      value: `${formatNumber(r.autoShare, locale)} %`,
      growth: g(r.autoShare, before.autoShare),
      detail: t('report.autoDetail'),
    },
  ];

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('report.title')}
        subtitle={t('report.intro')}
        actions={
          <>
            <ButtonLink
              href={`/platform/admin/reports/revenue/export.csv?${monthQuery(m)}`}
              prefetch={false}
            >
              <Icon icon={Download} size={16} />
              CSV
            </ButtonLink>
            <ButtonLink
              href={`/platform/admin/reports/revenue/export.pdf?${monthQuery(m)}`}
              prefetch={false}
            >
              <Icon icon={Download} size={16} />
              PDF
            </ButtonLink>
            <SendReportButton month={m.key} label={t('report.sendBookkeeper')} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card padding="none" className="h-max overflow-hidden p-2 lg:col-span-3 xl:col-span-2">
          <nav aria-label={t('report.months')} className="flex flex-col gap-1">
            {reports.map((x) => {
              const active = x.month.key === m.key;
              return (
                <Link
                  key={x.month.key}
                  href={`/platform/admin/reports/revenue?${monthQuery(x.month)}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-sm px-3 py-2.5 no-underline',
                    active ? 'bg-fg-1 text-white' : 'text-fg-1 hover:bg-bg-base',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-table font-semibold">
                      {monthYear(x.month.start, locale)}
                    </span>
                    <span
                      className={cn(
                        'truncate text-micro',
                        active ? 'text-on-navy-muted' : 'text-fg-2',
                      )}
                    >
                      {x.open
                        ? t('report.preliminary')
                        : `${kr(x.revenueOre, locale)} kr. · ${formatMinutes(x.billedMinutes, locale)}`}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex-none text-micro font-semibold',
                      active ? 'text-primary' : x.open ? 'text-info-fg' : 'text-ok-fg',
                    )}
                  >
                    {x.open
                      ? t('report.open')
                      : x.paidShare >= 99.5
                        ? t('state.paid')
                        : t('report.paidPct', { pct: formatNumber(x.paidShare, locale) })}
                  </span>
                </Link>
              );
            })}
          </nav>
        </Card>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-9 xl:col-span-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="m-0 text-section">{monthYear(m.start, locale)}</h2>
            <span className="text-meta text-fg-2">
              {r.open
                ? t('report.metaOpen', { prev: prevName })
                : t('report.metaClosed', {
                    closed: dayMonth(new Date(m.end.getTime() - 1), locale),
                    sent: dayMonth(m.end, locale),
                    prev: prevName,
                  })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero">
            <KpiCard
              hero
              icon={FileText}
              label={t('report.revenue')}
              growth={growthOf(
                growthPct(r.revenueOre, before.revenueOre),
                (x) =>
                  t('billing.vsPrev', {
                    pct: x,
                    month: monthShort(shiftMonth(m, -1).start, locale),
                  }),
                locale,
              )}
              value={kr(r.revenueOre, locale)}
              unit="kr."
              visual={<HeroCurve data={past.map((x) => x.revenueOre)} />}
              footer={
                <span className="flex justify-between gap-2">
                  <span>
                    {prevName} {kr(before.revenueOre, locale)} kr.
                  </span>
                  <span>{t('report.exVat')}</span>
                </span>
              }
            />
            <KpiCard
              icon={Clock}
              label={t('kind.subscription')}
              growth={g(r.subscriptionOre, before.subscriptionOre)}
              value={kr(r.subscriptionOre, locale)}
              unit="kr."
              visual={
                <MiniBars
                  items={past.map((x) => ({
                    label: monthShort(x.month.start, locale),
                    value: x.subscriptionOre,
                  }))}
                />
              }
              footer={t('report.activeEnd', { count: r.activeAtEnd })}
            />
            <KpiCard
              icon={Headphones}
              label={t('kind.support')}
              growth={g(r.supportOre, before.supportOre)}
              value={kr(r.supportOre, locale)}
              unit="kr."
              visual={
                <MiniBars
                  items={past.map((x) => ({
                    label: monthShort(x.month.start, locale),
                    value: x.supportOre,
                  }))}
                />
              }
              footer={formatMinutes(r.billedMinutes, locale)}
            />
            <KpiCard
              icon={CircleCheck}
              label={t('billing.rate')}
              value={`${formatNumber(pct(r.billableMinutes, r.billableMinutes + r.nonBillableMinutes), locale)} %`}
              visual={
                <Gauge
                  percent={pct(r.billableMinutes, r.billableMinutes + r.nonBillableMinutes)}
                  label={t('billing.rate')}
                />
              }
              footer={t('report.rateDetail', {
                billable: formatMinutes(r.billableMinutes, locale),
                not: formatMinutes(r.nonBillableMinutes, locale),
              })}
            />
            <KpiCard
              icon={TriangleAlert}
              iconTone={r.outstandingGross ? 'error' : 'muted'}
              label={t('report.outstanding')}
              value={kr(r.outstandingGross, locale)}
              unit="kr."
              visual={
                <SegmentBar
                  segments={[
                    { value: r.paidShare, tone: 'ink' },
                    { value: 100 - r.paidShare, tone: 'error' },
                  ]}
                />
              }
              footer={t('report.outstandingDetail', {
                pct: formatNumber(r.paidShare, locale),
                days: r.oldestOverdueDays,
              })}
            />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-1 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <span className="text-table font-medium text-fg-2">{s.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-section font-bold tabular">{s.value}</span>
                  {s.growth && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-micro font-semibold',
                        s.growth.tone === 'good'
                          ? 'bg-ok-bg text-ok-fg'
                          : s.growth.tone === 'bad'
                            ? 'bg-error-bg text-error-fg'
                            : 'bg-bg-base text-fg-1',
                      )}
                    >
                      {s.growth.direction === 'up' ? '↑' : s.growth.direction === 'down' ? '↓' : ''}{' '}
                      {s.growth.text}
                    </span>
                  )}
                </span>
                <span className="text-meta text-fg-2">{s.detail}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card padding="none">
              <PanelHeader
                title={t('report.topCustomers')}
                action={<span className="text-meta text-fg-2">{t('report.shareOfSupport')}</span>}
              />
              <Table>
                <thead>
                  <tr>
                    <Th className="pl-5">{t('col.customer')}</Th>
                    <Th numeric>{t('col.billed')}</Th>
                    <Th numeric>{t('draft.amount')}</Th>
                    <Th className="pr-5">{t('report.share')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.topCustomers.slice(0, 5).map((c) => (
                    <Tr key={c.tenantId}>
                      <Td className="pl-5">{c.name}</Td>
                      <Td numeric>{formatMinutes(c.billedMinutes, locale)}</Td>
                      <Td numeric>{kr(c.netOre, locale)} kr.</Td>
                      <Td className="pr-5">
                        <span className="flex items-center gap-3">
                          <span className="h-2 w-28 overflow-hidden rounded-full bg-bg-base">
                            <span
                              className="block h-full rounded-full bg-navy"
                              style={{ width: `${supportShare(c.netOre)}%` }}
                            />
                          </span>
                          <span className="text-meta text-fg-2 tabular">
                            {formatNumber(supportShare(c.netOre), locale)} %
                          </span>
                        </span>
                      </Td>
                    </Tr>
                  ))}
                  {r.topCustomers.length === 0 && (
                    <tr>
                      <Td colSpan={4} className="px-5 text-fg-2">
                        {t('noSupport')}
                      </Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card>
            <Card padding="none">
              <PanelHeader
                title={t('report.perStaff')}
                action={
                  <span className="text-meta text-fg-2">
                    {t('report.autoShare', { pct: formatNumber(r.autoShare, locale) })}
                  </span>
                }
              />
              <Table>
                <thead>
                  <tr>
                    <Th className="pl-5">{t('billing.supporter')}</Th>
                    <Th numeric>{t('billing.billableLegend')}</Th>
                    <Th numeric>{t('report.notBillable')}</Th>
                    <Th numeric className="pr-5">
                      {t('col.cases')}
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {r.perStaff.map((s) => (
                    <Tr key={s.name}>
                      <Td className="pl-5">{s.name}</Td>
                      <Td numeric>{formatMinutes(s.billable, locale)}</Td>
                      <Td numeric>{formatMinutes(s.nonBillable, locale)}</Td>
                      <Td numeric className="pr-5">
                        {s.cases}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-subrow font-semibold">
                    <td className="h-11 pl-5">{t('report.total')}</td>
                    <td className="h-11 px-3 text-right tabular">
                      {formatMinutes(staffTotal.billable, locale)}
                    </td>
                    <td className="h-11 px-3 text-right tabular">
                      {formatMinutes(staffTotal.nonBillable, locale)}
                    </td>
                    <td className="h-11 pr-5 pl-3 text-right tabular">{staffTotal.cases}</td>
                  </tr>
                </tfoot>
              </Table>
            </Card>
          </div>
        </div>
      </div>
    </PageBody>
  );
  const mobile = (
    <ReportsMobile
      d={{
        months: reports.map((x, i) => ({ r: x, before: reports[i + 1] ?? oldest })),
        selected: r,
      }}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
