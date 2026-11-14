import { formatDate, formatNumber, type Locale } from '@agentor/i18n';
import {
  Card,
  Gauge,
  HeroCurve,
  Icon,
  KpiCard,
  KpiLegend,
  KpiSplit,
  MiniBars,
  SegmentBar,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
} from '@agentor/ui';
import {
  CalendarClock,
  CircleSlash,
  CreditCard,
  Download,
  FileText,
  Layers,
  PenLine,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ComponentProps } from 'react';
import Link from 'next/link';
import { Responsive } from '@agentor/ui/mobile';
import { ButtonLink } from '@/components/button-link';
import { DiscountButton } from '@/components/platform/finance/discount-dialog';
import {
  CustomerChip,
  FilterChips,
  dayMonth,
  growthOf,
  kr,
  monthShort,
  withParams,
} from '@/components/platform/finance/bits';
import { QueryFilters } from '@/components/platform/query-filters';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import {
  currentMonth,
  daysBetween,
  financeInvoicesAll,
  growthPct,
  isLive,
  monthsBack,
  mrrSeries,
  pct,
  subscriptionRows,
  type SubRow,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { SubscriptionsMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance');
  return { title: t('tab.subscriptions') };
}

const PAGE = 25;
const FILTERS = ['all', 'month', 'year', 'trial', 'cancelled', 'problems'] as const;
type Filter = (typeof FILTERS)[number];

function matches(s: SubRow, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'month') return isLive(s) && s.interval === 'month' && s.state !== 'trial';
  if (f === 'year') return isLive(s) && s.interval === 'year';
  if (f === 'trial') return s.state === 'trial';
  if (f === 'cancelled') return s.state === 'cancelled' || s.state === 'ended';
  return s.state === 'failed' || s.state === 'card_expiring';
}

type Status = ComponentProps<typeof StatusPill>['status'];

function stateStatus(s: SubRow['state']): Status {
  return s === 'paid'
    ? 'ok'
    : s === 'failed'
      ? 'error'
      : s === 'card_expiring'
        ? 'warn'
        : s === 'renews' || s === 'trial'
          ? 'info'
          : 'paused';
}

/** Finans · Abonnementer (F2): every subscription, its price, period, next charge and status. */
export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; plan?: string; page?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.f ?? '')
    ? (sp.f as Filter)
    : 'all';
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  const months = monthsBack(cur, 12);
  const [subs, invoices] = await Promise.all([
    subscriptionRows(actor, now),
    financeInvoicesAll(actor),
  ]);
  const live = subs.filter(isLive);
  const paying = live.filter((s) => s.state !== 'trial');

  const mrr = paying.reduce((a, s) => a + s.mrrOre, 0);
  const series = mrrSeries(invoices, months).map((v) => v * 12);
  series[series.length - 1] = mrr * 12;
  const yearly = live.filter((s) => s.interval === 'year').length;
  const startup = live.filter((s) => s.planId === 'startup').length;
  const enterprise = live.filter((s) => s.planId === 'enterprise').length;
  const trials = subs.filter((s) => s.state === 'trial');
  const trialsThisWeek = trials.filter(
    (s) => s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() < 7 * 86_400_000,
  ).length;
  const since90 = new Date(now.getTime() - 90 * 86_400_000);
  const endedTrials = subs.filter(
    (s) => s.trialEndsAt && s.trialEndsAt < now && s.trialEndsAt > since90,
  );
  const converted = endedTrials.filter((s) => isLive(s) && !s.cancelAt).length;
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const cancelled30 = subs.filter((s) => s.cancelAt && s.cancelAt > since30).length;
  const churn = pct(cancelled30, Math.max(1, live.length));
  const since60 = new Date(now.getTime() - 60 * 86_400_000);
  const cancelledBefore = subs.filter(
    (s) => s.cancelAt && s.cancelAt > since60 && s.cancelAt <= since30,
  ).length;
  const churnBars = monthsBack(cur, 6).map((m) => ({
    label: monthShort(m.start, locale),
    value: subs.filter((s) => s.cancelAt && s.cancelAt >= m.start && s.cancelAt < m.end).length,
  }));

  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, subs.filter((s) => matches(s, f)).length]),
  ) as Record<Filter, number>;
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = subs
    .filter((s) => matches(s, filter))
    .filter((s) => !sp.plan || s.planId === sp.plan)
    .filter((s) => !q || s.tenantName.toLowerCase().includes(q) || (s.cvr ?? '').includes(q))
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName, 'da'));
  const page = Math.max(1, Number(sp.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const base = { q: sp.q, plan: sp.plan };

  const methodCell = (s: SubRow) => {
    if (s.state === 'trial' && !s.cardLast4)
      return <span className="text-fg-2">{t('sub.noMethod')}</span>;
    if (s.paymentMethod === 'invoice')
      return (
        <span className="inline-flex items-center gap-2">
          <Icon icon={FileText} size={16} className="text-fg-2" />
          {t('sub.invoiceEan')}
        </span>
      );
    if (s.paymentMethod === 'mobilepay')
      return (
        <span className="inline-flex items-center gap-2">
          <Icon icon={Smartphone} size={16} className="text-fg-2" />
          MobilePay
        </span>
      );
    return (
      <span className="inline-flex items-center gap-2">
        <Icon
          icon={CreditCard}
          size={16}
          className={s.state === 'card_expiring' ? 'text-warn-fg' : 'text-fg-2'}
        />
        {s.cardBrand === 'mastercard' ? 'Mastercard' : 'Visa'} •••• {s.cardLast4}
      </span>
    );
  };
  const nextCharge = (s: SubRow) =>
    s.state === 'failed' && s.retryAt
      ? t('state.retrying', { date: dayMonth(s.retryAt, locale) })
      : s.state === 'trial' && s.trialEndsAt
        ? `${dayMonth(s.trialEndsAt, locale)} · ${kr(s.priceOre, locale)} kr.`
        : s.nextChargeAt
          ? s.interval === 'year'
            ? formatDate(s.nextChargeAt, locale)
            : dayMonth(s.nextChargeAt, locale)
          : t('sub.none');
  const methodText = (s: SubRow) =>
    s.state === 'trial' && !s.cardLast4
      ? t('sub.noMethod')
      : s.paymentMethod === 'invoice'
        ? t('sub.invoiceEan')
        : s.paymentMethod === 'mobilepay'
          ? 'MobilePay'
          : `${s.cardBrand === 'mastercard' ? 'Mastercard' : 'Visa'} •••• ${s.cardLast4}`;
  const statusLabel = (s: SubRow) =>
    s.state === 'renews'
      ? t('state.renews', { days: daysBetween(now, s.nextChargeAt!) })
      : s.state === 'cancelled'
        ? t('state.cancelledUntil', { date: dayMonth(s.cancelAt!, locale) })
        : t(`state.${s.state}`);
  const period = (s: SubRow) => {
    if (s.state === 'trial' && s.trialEndsAt)
      return `${dayMonth(s.currentPeriodStart ?? now, locale)}–${dayMonth(s.trialEndsAt, locale)}`;
    if (!s.currentPeriodStart || !s.currentPeriodEnd) return '–';
    const end = new Date(s.currentPeriodEnd.getTime() - 1);
    return s.interval === 'year'
      ? `${formatDate(s.currentPeriodStart, locale)} – ${formatDate(end, locale)}`
      : `${dayMonth(s.currentPeriodStart, locale)}–${dayMonth(end, locale)}`;
  };

  const discountCustomers = live
    .filter((s) => s.state !== 'trial')
    .map((s) => ({ tenantId: s.tenantId, name: s.tenantName, discountPct: s.discountPct }));

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('tab.subscriptions')}
        subtitle={t('sub.intro')}
        actions={
          <>
            <ButtonLink
              href="/platform/finance/subscriptions/export"
              variant="secondary"
              prefetch={false}
            >
              <Icon icon={Download} size={16} />
              {t('export')}
            </ButtonLink>
            <DiscountButton customers={discountCustomers} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero">
        <KpiCard
          hero
          icon={CalendarClock}
          label={t('kpi.arr')}
          growth={growthOf(
            growthPct(series.at(-1) ?? 0, series[0] ?? 0),
            (a) => t('kpi.yoy', { pct: a }),
            locale,
          )}
          value={kr(mrr * 12, locale)}
          unit="kr."
          visual={<HeroCurve data={series} />}
          footer={
            <span className="flex justify-between gap-2">
              <span>
                {monthShort(months[0]!.start, locale)} {months[0]!.year} ·{' '}
                {kr(series[0] ?? 0, locale)} kr.
              </span>
              <span>{t('kpi.perMonthAmount', { amount: kr(mrr, locale) })}</span>
            </span>
          }
        />
        <KpiCard
          icon={UserRound}
          label={t('kpi.activeSubs')}
          {...(live.filter((s) => s.createdAt >= cur.start).length
            ? {
                growth: {
                  direction: 'up',
                  tone: 'good',
                  text: t('kpi.new', {
                    count: live.filter((s) => s.createdAt >= cur.start).length,
                  }),
                } as const,
              }
            : {})}
          value={formatNumber(live.length, locale)}
          split={
            <KpiSplit
              left={{ value: formatNumber(startup, locale), suffix: 'Startup' }}
              right={{
                value: formatNumber(live.length - startup, locale),
                suffix: 'Business / Enterprise',
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: live.length - startup - enterprise, tone: 'ink' },
                { value: enterprise, tone: 'navy' },
                { value: startup, tone: 'hatch' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: 'Business' },
                { tone: 'navy', label: 'Enterprise' },
                { tone: 'hatch', label: 'Startup' },
              ]}
            />
          }
        />
        <KpiCard
          icon={Layers}
          label={t('kpi.yearlySubs')}
          value={`${formatNumber(pct(yearly, live.length), locale)} %`}
          visual={<Gauge percent={pct(yearly, live.length)} label={t('kpi.yearlySubs')} />}
          split={
            <KpiSplit
              left={{ value: formatNumber(yearly, locale), suffix: t('perYear') }}
              right={{ value: formatNumber(live.length - yearly, locale), suffix: t('perMonth') }}
            />
          }
        />
        <KpiCard
          icon={PenLine}
          label={t('kpi.trials')}
          value={formatNumber(trials.length, locale)}
          split={
            <KpiSplit
              left={{
                value: endedTrials.length
                  ? `${formatNumber(pct(converted, endedTrials.length), locale)} %`
                  : '–',
                suffix: t('kpi.becomeCustomers'),
              }}
              right={{ value: formatNumber(trialsThisWeek, locale), suffix: t('kpi.endThisWeek') }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: converted, tone: 'ink' },
                { value: Math.max(0, trials.length - trialsThisWeek), tone: 'muted' },
                { value: trialsThisWeek, tone: 'hatch' },
              ]}
            />
          }
          footer={t('kpi.conversion90')}
        />
        <KpiCard
          icon={CircleSlash}
          label={t('kpi.churn')}
          value={formatNumber(churn, locale, 1)}
          unit="%"
          visual={<MiniBars items={churnBars} />}
          footer={t('kpi.cancelled30', { count: cancelled30 })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <QueryFilters
          searchLabel={t('sub.search')}
          filters={[
            {
              key: 'plan',
              label: t('col.plan'),
              allLabel: t('sub.allPlans'),
              options: [
                { value: 'startup', label: 'Startup' },
                { value: 'business', label: 'Business' },
                { value: 'enterprise', label: 'Enterprise' },
              ],
            },
          ]}
        />
        <FilterChips
          label={t('sub.filters')}
          items={FILTERS.map((f) => ({
            href: withParams('/platform/finance/subscriptions', {
              ...base,
              f: f === 'all' ? undefined : f,
            }),
            label: `${t(`sub.filter.${f}`)} · ${counts[f]}`,
            active: filter === f,
          }))}
        />
      </div>

      <Card padding="none">
        <Table>
          <thead>
            <tr>
              <Th className="pl-5">{t('col.customer')}</Th>
              <Th>{t('col.plan')}</Th>
              <Th>{t('col.interval')}</Th>
              <Th numeric>{t('col.priceExVat')}</Th>
              <Th>{t('col.period')}</Th>
              <Th>{t('col.nextCharge')}</Th>
              <Th>{t('col.method')}</Th>
              <Th className="pr-5">{t('col.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <Tr key={s.id} interactive>
                <Td className="pl-5">
                  <Link
                    href={`/platform/finance/customers/${s.tenantId}`}
                    className="flex flex-col text-fg-1 no-underline"
                  >
                    <CustomerChip name={s.tenantName} />
                    {s.cvr && <span className="pl-9 text-meta text-fg-2">CVR {s.cvr}</span>}
                  </Link>
                </Td>
                <Td>{s.planName}</Td>
                <Td>
                  {s.state === 'trial'
                    ? t('state.trial')
                    : s.interval === 'year'
                      ? t('sub.yearly')
                      : t('sub.monthly')}
                </Td>
                <Td numeric>
                  {s.state === 'trial'
                    ? '0 kr.'
                    : `${kr(s.priceOre, locale)} kr.${s.interval === 'year' ? t('perYearShort') : t('perMonthShort')}`}
                  {s.discountPct ? (
                    <span className="block text-micro text-fg-2">
                      {t('sub.discount', { pct: s.discountPct })}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-fg-2">{period(s)}</Td>
                <Td className={s.state === 'failed' ? 'font-medium text-error-fg' : ''}>
                  {nextCharge(s)}
                </Td>
                <Td>{methodCell(s)}</Td>
                <Td className="pr-5">
                  <StatusPill status={stateStatus(s.state)}>{statusLabel(s)}</StatusPill>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-meta text-fg-2">
            {t('sub.showing', { shown: shown.length, total: rows.length })}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <ButtonLink
                size="s"
                href={withParams('/platform/finance/subscriptions', {
                  ...base,
                  f: sp.f,
                  page: String(page - 1),
                })}
              >
                {t('previous')}
              </ButtonLink>
            )}
            {page * PAGE < rows.length && (
              <ButtonLink
                size="s"
                href={withParams('/platform/finance/subscriptions', {
                  ...base,
                  f: sp.f,
                  page: String(page + 1),
                })}
              >
                {t('next')}
              </ButtonLink>
            )}
          </span>
        </div>
      </Card>
      <p className="m-0 text-meta text-fg-2">{t('sub.footnote')}</p>
    </PageBody>
  );
  const mobile = (
    <SubscriptionsMobile
      d={{
        month: cur.start,
        mrr,
        series,
        live: live.length,
        startup,
        trials: trials.length,
        conversion: endedTrials.length ? pct(converted, endedTrials.length) : null,
        churn,
        churnBefore: pct(cancelledBefore, Math.max(1, live.length)),
        cancelled30,
        filter,
        counts: {
          all: counts.all,
          problems: counts.problems,
          year: counts.year,
          trial: counts.trial,
        },
        rows: shown.map((s) => ({
          s,
          status: stateStatus(s.state),
          label: statusLabel(s),
          next: nextCharge(s),
          method: methodText(s),
        })),
        total: rows.length,
        page,
        pageSize: PAGE,
        params: { ...base, f: sp.f },
        discountCustomers,
      }}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
