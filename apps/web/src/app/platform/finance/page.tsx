import { formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
import {
  Card,
  Gauge,
  HeroCurve,
  Icon,
  KpiCard,
  KpiLegend,
  KpiSplit,
  SegmentBar,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
} from '@agentor/ui';
import {
  CalendarClock,
  Download,
  FileText,
  Headphones,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import {
  CustomerChip,
  PanelHeader,
  ToggleLinks,
  dayMonth,
  growthOf,
  kr,
  money,
  monthLong,
  monthShort,
  monthYear,
} from '@/components/platform/finance/bits';
import { RevenueChart } from '@/components/platform/finance/revenue-chart';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import {
  counted,
  currentMonth,
  daysBetween,
  financeInvoicesAll,
  growthPct,
  isLive,
  monthsBack,
  mrrSeries,
  paymentState,
  pct,
  projectMinutes,
  revenueByDay,
  revenueByMonth,
  shiftMonth,
  subscriptionRows,
  supportForMonth,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { Responsive } from '@agentor/ui/mobile';
import { FinanceMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance');
  return { title: t('title') };
}

/** Axis ticks rounded to a readable step ("60k" … "0"). */
function axis(maxOre: number, locale: Locale) {
  const max = Math.max(1, maxOre / 100);
  const step =
    [1_000, 2_500, 5_000, 10_000, 15_000, 25_000, 50_000, 100_000].find((s) => s * 4 >= max) ??
    Math.ceil(max / 4 / 100_000) * 100_000;
  return [4, 3, 2, 1, 0].map((i) => ({
    value: step * i * 100,
    label:
      i === 0
        ? '0'
        : step * i >= 1000
          ? `${formatNumber((step * i) / 1000, locale)}k`
          : String(step * i),
  }));
}

/** Finans · Oversigt (F1): revenue, subscriptions, support, overdue and what needs action. */
export default async function FinanceOverview({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const { view } = await searchParams;
  const mode = view === 'days' ? 'days' : 'months';
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  const prev = shiftMonth(cur, -1);
  const months = monthsBack(cur, 12);
  const [subs, invoices, support] = await Promise.all([
    subscriptionRows(actor, now),
    financeInvoicesAll(actor),
    supportForMonth(actor, cur),
  ]);
  const live = subs.filter(isLive);
  const paying = live.filter((s) => s.state !== 'trial');

  // 1. Monthly recurring revenue.
  const mrr = paying.reduce((a, s) => a + s.mrrOre, 0);
  const series = mrrSeries(invoices, months);
  series[series.length - 1] = mrr;
  const mrrPrev = series[series.length - 2] ?? 0;

  // 2. Subscriptions.
  const newThisMonth = live.filter((s) => s.createdAt >= cur.start).length;
  const yearly = live.filter((s) => s.interval === 'year').length;
  const startup = live.filter((s) => s.planId === 'startup').length;

  // 3. Support this month: billable registered time against the projection.
  const supportRegistered = support.customers.reduce((a, c) => a + c.registered, 0);
  const supportBilled = support.customers.reduce((a, c) => a + c.billed, 0);
  const supportGross = support.customers.reduce((a, c) => a + c.grossOre, 0);
  const supportNet = support.customers.reduce((a, c) => a + c.netOre, 0);
  const projected = projectMinutes(supportRegistered, cur, now);
  const lastSupport = invoices
    .filter(
      (i) => i.kind === 'support' && counted(i) && i.periodStart.getTime() === prev.start.getTime(),
    )
    .reduce((a, i) => a + i.lines.reduce((b, l) => b + (l.registeredMinutes ?? 0), 0), 0);

  // 4. Overdue.
  const states = invoices.map((i) => ({ i, s: paymentState(i, now) }));
  const overdue = states.filter((x) =>
    ['overdue', 'reminded', 'card_failed', 'retrying'].includes(x.s),
  );
  const overdueGross = overdue.reduce((a, x) => a + x.i.grossOre, 0);
  const issuedNow = invoices.filter((i) => counted(i) && (i.issuedAt ?? i.createdAt) >= cur.start);
  const paidNow = issuedNow.filter((i) => i.status === 'paid');
  const paidGross = paidNow.reduce((a, i) => a + i.grossOre, 0);
  const issuedGross = issuedNow.reduce((a, i) => a + i.grossOre, 0);

  // 5. Year to date (ex. VAT).
  const yearStart =
    months.find((m) => m.month === 1 && m.year === cur.year)?.start ??
    new Date(Date.UTC(cur.year, 0, 1));
  const ytd = invoices.filter((i) => counted(i) && (i.issuedAt ?? i.createdAt) >= yearStart);
  const ytdNet = ytd.reduce((a, i) => a + i.netOre, 0);
  const ytdSubs = ytd.filter((i) => i.kind === 'subscription').reduce((a, i) => a + i.netOre, 0);
  const lastYear = invoices.filter((i) => {
    const d = i.issuedAt ?? i.createdAt;
    return (
      counted(i) &&
      d >= new Date(yearStart.getTime() - 365 * 86_400_000) &&
      d < new Date(now.getTime() - 365 * 86_400_000)
    );
  });
  const lastYearNet = lastYear.reduce((a, i) => a + i.netOre, 0);

  // Revenue chart.
  const revenue = revenueByMonth(invoices, months, supportNet);
  const total12 = revenue.reduce((a, r) => a + r.subscriptionOre + r.supportOre, 0);
  const prior = revenueByMonth(invoices, monthsBack(shiftMonth(cur, -12), 12));
  const prior12 = prior.reduce((a, r) => a + r.subscriptionOre + r.supportOre, 0);
  const days = revenueByDay(invoices, cur, now);
  const maxMonth = Math.max(...revenue.map((r) => r.subscriptionOre + r.supportOre));
  const maxDay = Math.max(1, ...days.map((d) => d.ore));
  const dayForecast =
    (days.at(-1)?.cumulativeOre ?? 0) +
    paying
      .filter((s) => s.nextChargeAt && s.nextChargeAt >= now && s.nextChargeAt < cur.end)
      .reduce((a, s) => a + s.priceOre, 0);

  // Needs action and renewals.
  const actions = [
    ...subs
      .filter((s) => s.state === 'failed')
      .map((s) => ({
        tenantId: s.tenantId,
        name: s.tenantName,
        detail: t('action.cardFailed', {
          count:
            invoices.find((i) => i.tenantId === s.tenantId && i.status === 'failed')?.attempts ?? 1,
          amount: money(
            invoices.find((i) => i.tenantId === s.tenantId && i.status === 'failed')?.grossOre ?? 0,
            locale,
          ),
        }),
        pill: { status: 'error' as const, label: t('state.failed') },
      })),
    ...overdue
      .filter((x) => x.i.status === 'open')
      .map((x) => ({
        tenantId: x.i.tenantId,
        name: x.i.tenantName,
        detail: t('action.overdue', {
          what: x.i.kind === 'support' ? t('kind.support') : t('kind.subscription'),
          month: monthLong(x.i.periodStart, locale),
          amount: money(x.i.grossOre, locale),
          days: daysBetween(x.i.dueAt!, now),
        }),
        pill: { status: 'warn' as const, label: t('state.overdue') },
      })),
    ...subs
      .filter((s) => s.state === 'card_expiring')
      .map((s) => ({
        tenantId: s.tenantId,
        name: s.tenantName,
        detail: t('action.cardExpiring', {
          card: `${s.cardBrand === 'mastercard' ? 'Mastercard' : 'Visa'} •••• ${s.cardLast4}`,
          date: dayMonth(new Date(cur.end.getTime() - 1), locale),
        }),
        pill: { status: 'warn' as const, label: t('state.card_expiring') },
      })),
  ];
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const renewals = live
    .filter(
      (s) =>
        s.interval === 'year' &&
        ((s.nextChargeAt && s.nextChargeAt <= in30) || (s.cancelAt && s.cancelAt <= in30)),
    )
    .sort(
      (a, b) =>
        (a.cancelAt ?? a.nextChargeAt!).getTime() - (b.cancelAt ?? b.nextChargeAt!).getTime(),
    );
  const monthlyDue = paying.filter((s) => s.interval === 'month' && !s.cancelAt);

  const growthText = (abs: string) => `${abs} %`;
  const ticks = axis(mode === 'months' ? maxMonth : maxDay, locale);
  const viewHref = (v: string) =>
    v === 'days' ? '/platform/finance?view=days' : '/platform/finance';

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <>
            <ButtonLink
              href="/platform/finance/invoicing/export"
              variant="secondary"
              prefetch={false}
            >
              <Icon icon={Download} size={16} />
              {t('export')}
            </ButtonLink>
            <ButtonLink href="/platform/admin/reports/revenue" variant="primary" size="l">
              <Icon icon={FileText} size={16} />
              {t('monthlyReport')}
            </ButtonLink>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero">
        <KpiCard
          hero
          icon={CalendarClock}
          label={t('kpi.mrr')}
          growth={growthOf(growthPct(mrr, mrrPrev), growthText, locale)}
          value={kr(mrr, locale)}
          unit="kr."
          visual={<HeroCurve data={series} />}
          footer={
            <span className="flex justify-between gap-2">
              <span>
                {monthShort(months[0]!.start, locale)} {months[0]!.year} ·{' '}
                {kr(series[0] ?? 0, locale)} kr.
              </span>
              <span>
                {t('kpi.sinceLast', {
                  amount: `${mrr - mrrPrev >= 0 ? '+' : '−'}${kr(Math.abs(mrr - mrrPrev), locale)}`,
                  month: monthLong(prev.start, locale),
                })}
              </span>
            </span>
          }
        />
        <KpiCard
          icon={UserRound}
          label={t('kpi.subscriptions')}
          {...(newThisMonth
            ? {
                growth: {
                  direction: 'up',
                  tone: 'good',
                  text: t('kpi.new', { count: newThisMonth }),
                } as const,
              }
            : {})}
          value={formatNumber(live.length, locale)}
          split={
            <KpiSplit
              left={{ value: formatNumber(live.length - yearly, locale), suffix: t('perMonth') }}
              right={{ value: formatNumber(yearly, locale), suffix: t('perYear') }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: live.length - startup, tone: 'ink' },
                { value: startup, tone: 'hatch' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: t('kpi.businessEnterprise') },
                { tone: 'hatch', label: `Startup ${startup}` },
              ]}
            />
          }
        />
        <KpiCard
          icon={Headphones}
          label={t('kpi.support')}
          growth={growthOf(growthPct(supportRegistered, lastSupport), growthText, locale)}
          value={formatMinutes(supportRegistered, locale)}
          visual={
            <Gauge percent={pct(supportRegistered, projected)} label={t('kpi.supportGauge')} />
          }
          split={
            <KpiSplit
              left={{
                value: `${formatNumber(pct(supportRegistered, projected), locale)} %`,
                suffix: t('kpi.ofForecast'),
              }}
              right={{ value: formatMinutes(supportBilled, locale), suffix: t('kpi.billed') }}
            />
          }
          footer={t('kpi.forecastFooter', { forecast: formatMinutes(projected, locale) })}
        />
        <KpiCard
          icon={TriangleAlert}
          iconTone="error"
          label={t('kpi.overdue')}
          {...(overdue.length
            ? {
                growth: {
                  direction: 'down',
                  tone: 'bad',
                  text: t('kpi.invoices', { count: overdue.length }),
                } as const,
              }
            : {})}
          value={kr(overdueGross, locale)}
          unit="kr."
          split={
            <KpiSplit
              left={{
                value: `${formatNumber(pct(paidGross, issuedGross), locale)} %`,
                suffix: t('kpi.paidIn', { month: monthLong(cur.start, locale) }),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: paidGross, tone: 'ink' },
                { value: overdueGross, tone: 'error' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: `${t('kpi.paid')} ${kr(paidGross, locale)} kr.` },
                { tone: 'error', label: t('kpi.overdue') },
              ]}
            />
          }
        />
        <KpiCard
          icon={FileText}
          label={t('kpi.ytd')}
          growth={growthOf(growthPct(ytdNet, lastYearNet), growthText, locale)}
          value={kr(ytdNet, locale)}
          unit="kr."
          split={
            <KpiSplit
              left={{
                value: kr(ytdNet / Math.max(1, cur.month), locale),
                suffix: t('kpi.avgMonth'),
              }}
              right={{
                value: `${formatNumber(pct(ytdSubs, ytdNet), locale)} %`,
                suffix: t('kpi.subsShare'),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: ytdSubs, tone: 'ink' },
                { value: ytdNet - ytdSubs, tone: 'hatch' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: `${t('kpi.subsShort')} ${kr(ytdSubs, locale)}` },
                {
                  tone: 'hatch',
                  label: `${t('kpi.supportShort')} ${kr(ytdNet - ytdSubs, locale)}`,
                },
              ]}
            />
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="flex flex-col gap-4 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-table font-medium text-fg-2">
                <Icon icon={FileText} size={16} />
                {mode === 'months' ? t('chart.perMonth') : t('chart.perDay')}
              </span>
              <span className="flex items-baseline gap-3">
                <span className="text-kpi tabular">
                  {kr(mode === 'months' ? total12 : (days.at(-1)?.cumulativeOre ?? 0), locale)}
                  <span className="ml-1 align-super text-kpi-unit">kr.</span>
                </span>
                {mode === 'months' && growthPct(total12, prior12) !== null && (
                  <span className="rounded-full bg-ok-bg px-2 text-meta font-semibold text-ok-fg">
                    {t('chart.yoy', { pct: formatNumber(growthPct(total12, prior12)!, locale) })}
                  </span>
                )}
              </span>
              <span className="text-meta text-fg-2">
                {mode === 'months' ? t('chart.last12') : monthYear(cur.start, locale)}
              </span>
            </div>
            <div className="flex flex-col items-end gap-3">
              <ToggleLinks
                label={t('chart.view')}
                items={[
                  { href: viewHref('days'), label: t('chart.days'), active: mode === 'days' },
                  { href: viewHref('months'), label: t('chart.months'), active: mode === 'months' },
                ]}
              />
              <KpiLegend
                items={[
                  { tone: 'ink', label: t('chart.subscriptions') },
                  { tone: 'hatch', label: t('chart.support') },
                ]}
              />
            </div>
          </div>
          <RevenueChart
            mode={mode}
            label={mode === 'months' ? t('chart.perMonth') : t('chart.perDay')}
            ticks={ticks}
            forecastDays={dayForecast}
            months={revenue.map((r, i) => ({
              label: monthShort(r.month.start, locale),
              subscription: r.subscriptionOre,
              support: r.supportOre,
              forecast: r.forecast,
              title: `${kr(r.subscriptionOre + r.supportOre, locale)} kr.`,
              detail: t('chart.tooltip', {
                month: monthYear(r.month.start, locale),
                subscriptions: kr(r.subscriptionOre, locale),
                support: kr(r.supportOre, locale),
              }),
              ...(i > 0 &&
              growthPct(
                r.subscriptionOre + r.supportOre,
                revenue[i - 1]!.subscriptionOre + revenue[i - 1]!.supportOre,
              ) !== null
                ? {
                    growth: `${formatNumber(growthPct(r.subscriptionOre + r.supportOre, revenue[i - 1]!.subscriptionOre + revenue[i - 1]!.supportOre)!, locale)} %`,
                  }
                : {}),
            }))}
            days={days.map((d) => ({
              label: String(d.day),
              value: d.ore,
              cumulative: d.cumulativeOre,
              future: d.future,
              title: `${d.day}. · ${kr(d.ore, locale)} kr. · ${t('chart.cumulative')} ${kr(d.cumulativeOre, locale)} kr.`,
            }))}
          />
        </Card>
        <div className="flex flex-col gap-5 lg:col-span-4">
          <Card padding="none">
            <PanelHeader
              title={t('needsAction')}
              action={<span className="text-meta text-fg-2">{actions.length}</span>}
            />
            {actions.length === 0 ? (
              <p className="m-0 px-5 pb-5 text-table text-fg-2">{t('nothingNeeded')}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {actions.map((a) => (
                  <li key={`${a.tenantId}-${a.detail}`} className="shadow-hairline-t">
                    <Link
                      href={`/platform/finance/customers/${a.tenantId}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-fg-1 no-underline hover:bg-row-hover"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-table font-semibold">{a.name}</span>
                        <span className="truncate text-meta text-fg-2">{a.detail}</span>
                      </span>
                      <StatusPill status={a.pill.status}>{a.pill.label}</StatusPill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card padding="none">
            <PanelHeader
              title={t('renewals')}
              action={
                <Link
                  href="/platform/finance/subscriptions"
                  className="text-table font-semibold text-fg-1"
                >
                  {t('seeAll')}
                </Link>
              }
            />
            <ul className="m-0 list-none p-0">
              {renewals.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 shadow-hairline-t"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-table font-semibold">{s.tenantName}</span>
                    <span className="truncate text-meta text-fg-2">
                      {s.cancelAt
                        ? t('renewal.ends', {
                            plan: s.planName,
                            date: dayMonth(s.cancelAt, locale),
                          })
                        : t('renewal.renews', {
                            plan: s.planName,
                            date: dayMonth(s.nextChargeAt!, locale),
                            method: t(`method.${s.paymentMethod}`),
                          })}
                    </span>
                  </span>
                  {s.cancelAt ? (
                    <StatusPill status="paused" compact>
                      {t('state.cancelled')}
                    </StatusPill>
                  ) : (
                    <span className="whitespace-nowrap text-table tabular">
                      {money(s.priceOre, locale)}
                    </span>
                  )}
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 px-5 py-3 shadow-hairline-t">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-table font-semibold">
                    {t('renewal.monthly', { count: monthlyDue.length })}
                  </span>
                  <span className="truncate text-meta text-fg-2">
                    {t('renewal.monthlyWhen', { date: dayMonth(cur.end, locale) })}
                  </span>
                </span>
                <span className="whitespace-nowrap text-table tabular">
                  {money(
                    monthlyDue.reduce((a, s) => a + s.priceOre, 0),
                    locale,
                  )}
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Card padding="none">
        <PanelHeader
          title={t('supportPreliminary', { month: monthLong(cur.start, locale) })}
          action={
            <Link href="/platform/finance/support" className="text-table font-semibold text-fg-1">
              {t('openBilling')}
            </Link>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>{t('col.customer')}</Th>
              <Th>{t('col.plan')}</Th>
              <Th numeric>{t('col.cases')}</Th>
              <Th numeric>{t('col.registered')}</Th>
              <Th numeric>{t('col.billed')}</Th>
              <Th numeric>{t('col.amountInclVat')}</Th>
              <Th>{t('col.latestCase')}</Th>
            </tr>
          </thead>
          <tbody>
            {support.customers.slice(0, 8).map((c) => (
              <Tr key={c.tenantId}>
                <Td>
                  <Link
                    href={`/platform/finance/customers/${c.tenantId}`}
                    className="text-fg-1 no-underline"
                  >
                    <CustomerChip name={c.tenantName} />
                  </Link>
                </Td>
                <Td>{c.planName}</Td>
                <Td numeric>{c.lines.length}</Td>
                <Td numeric>{formatMinutes(c.registered, locale)}</Td>
                <Td numeric>{formatMinutes(c.billed, locale)}</Td>
                <Td numeric>{money(c.grossOre, locale)}</Td>
                <Td className="text-fg-2">
                  {c.latestCase ? `#${c.latestCase.number} ${c.latestCase.title}` : '–'}
                </Td>
              </Tr>
            ))}
            {support.customers.length === 0 && (
              <tr>
                <Td colSpan={7} className="text-fg-2">
                  {t('noSupport')}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
        <p className="m-0 px-5 py-3 text-meta text-fg-2 shadow-hairline-t">
          {t('supportTotal', {
            billed: formatMinutes(supportBilled, locale),
            amount: money(supportGross, locale),
          })}
        </p>
      </Card>
    </PageBody>
  );
  // MP06: whole kroner as on the board ("25.894 kr.").
  const lastMonth = revenue.at(-2);
  const krs = (ore: number) => `${kr(ore, locale)} kr.`;
  const mobile = (
    <FinanceMobile
      d={{
        month: monthYear(cur.start, locale),
        monthName: monthLong(cur.start, locale),
        mrr: krs(mrr),
        mrrGrowth: growthOf(growthPct(mrr, mrrPrev), growthText, locale),
        subscriptions: live.length,
        newSubs: newThisMonth,
        paymentProblems: subs.filter((s) => s.state === 'failed').length,
        supportNet: krs(supportNet),
        supportTime: formatMinutes(supportRegistered, locale),
        supportGross: krs(supportGross),
        overdue: krs(overdueGross),
        overdueCount: overdue.length,
        ytd: krs(ytdNet),
        ytdGrowth: growthOf(growthPct(ytdNet, lastYearNet), growthText, locale),
        lastMonthName: monthLong(prev.start, locale),
        lastMonthTotal: krs((lastMonth?.subscriptionOre ?? 0) + (lastMonth?.supportOre ?? 0)),
        actions: actions.slice(0, 5).map((a, i) => ({
          key: `${a.tenantId}:${i}`,
          name: a.name,
          detail: a.detail,
          tone: a.pill.status,
          card: a.pill.label !== t('state.overdue'),
        })),
      }}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
