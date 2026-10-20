import { formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
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
  cn,
} from '@agentor/ui';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Download,
  Headphones,
  Layers,
  UserRound,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Responsive } from '@agentor/ui/mobile';
import { ButtonLink } from '@/components/button-link';
import {
  CustomerChip,
  ToggleLinks,
  dayMonth,
  growthOf,
  kr,
  money,
  monthLong,
  monthShort,
  withParams,
} from '@/components/platform/finance/bits';
import { PreviewInvoicesButton } from '@/components/platform/finance/draft-buttons';
import { QueryFilters } from '@/components/platform/query-filters';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import {
  counted,
  currentMonth,
  financeInvoicesAll,
  growthPct,
  monthsBack,
  parseMonth,
  pct,
  projectMinutes,
  shiftMonth,
  subscriptionRows,
  supportForMonth,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { SettlementMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance');
  return { title: t('tab.support') };
}

/** Finans · Supportafregning (F3): this month's support per customer and case. */
export default async function SupportBillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    plan?: string;
    staff?: string;
    q?: string;
    open?: string;
  }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  const m = parseMonth(sp.month, now);
  const isOpen = m.key === cur.key;
  const prev = shiftMonth(m, -1);
  const [data, prevData, subs, invoices] = await Promise.all([
    supportForMonth(actor, m, sp.staff ? { staffUserId: sp.staff } : {}),
    supportForMonth(actor, prev),
    subscriptionRows(actor, now),
    financeInvoicesAll(actor),
  ]);
  const q = (sp.q ?? '').trim().toLowerCase();
  const planOf = new Map(subs.map((s) => [s.tenantId, s.planId]));
  const customers = data.customers
    .filter((c) => !sp.plan || planOf.get(c.tenantId) === sp.plan)
    .filter((c) => !q || c.tenantName.toLowerCase().includes(q));
  const totals = customers.reduce(
    (a, c) => ({
      cases: a.cases + c.lines.length,
      registered: a.registered + c.registered,
      billed: a.billed + c.billed,
      gross: a.gross + c.grossOre,
      net: a.net + c.netOre,
      nonBillable: a.nonBillable + c.nonBillableMinutes,
    }),
    { cases: 0, registered: 0, billed: 0, gross: 0, net: 0, nonBillable: 0 },
  );
  // A closed month counts what was invoiced; time entries may since have been edited.
  const prevInvoices = invoices.filter(
    (i) => i.kind === 'support' && counted(i) && i.periodStart.getTime() === prev.start.getTime(),
  );
  const prevGross = prevInvoices.length
    ? prevInvoices.reduce((a, i) => a + i.grossOre, 0)
    : prevData.customers.reduce((a, c) => a + c.grossOre, 0);
  const prevBilled = prevInvoices.length
    ? prevInvoices.reduce((a, i) => a + i.lines.reduce((b, l) => b + (l.billedMinutes ?? 0), 0), 0)
    : prevData.customers.reduce((a, c) => a + c.billed, 0);
  const projected = isOpen ? projectMinutes(totals.registered, m, now) : totals.registered;
  const series = monthsBack(m, 12).map((mm) =>
    invoices
      .filter(
        (i) => i.kind === 'support' && counted(i) && i.periodStart.getTime() === mm.start.getTime(),
      )
      .reduce((a, i) => a + i.grossOre, 0),
  );
  series[series.length - 1] = totals.gross;
  const customersPerMonth = monthsBack(m, 6).map((mm, i, arr) => ({
    label: monthShort(mm.start, locale),
    value:
      i === arr.length - 1
        ? customers.length
        : new Set(
            invoices
              .filter(
                (x) =>
                  x.kind === 'support' &&
                  counted(x) &&
                  x.periodStart.getTime() === mm.start.getTime(),
              )
              .map((x) => x.tenantId),
          ).size,
  }));
  const live = subs.filter((s) => s.status === 'active' || s.status === 'past_due').length;
  const staffOptions = [
    ...new Map(data.entries.map((e) => [e.staffUserId, e.staffName])).entries(),
  ].map(([value, label]) => ({ value, label }));
  const base = { month: sp.month, plan: sp.plan, staff: sp.staff, q: sp.q };
  const href = (extra: Record<string, string | undefined>) =>
    withParams('/platform/finance/support', { ...base, ...extra });
  const statusOf = (c: (typeof customers)[number]) => {
    if (c.invoice?.status === 'paid')
      return (
        <StatusPill status="ok" compact>
          {t('state.paid')}
        </StatusPill>
      );
    if (c.invoice && c.invoice.status !== 'draft')
      return (
        <StatusPill status="info" compact>
          {t('state.awaiting')}
        </StatusPill>
      );
    if (c.invoice?.approvedAt)
      return (
        <StatusPill status="ok" compact>
          {t('state.approved')}
        </StatusPill>
      );
    if (c.invoice)
      return (
        <StatusPill status="info" compact>
          {t('state.draft')}
        </StatusPill>
      );
    if (c.cancelled)
      return (
        <StatusPill status="warn" compact>
          {t('state.cancelledBilled')}
        </StatusPill>
      );
    return (
      <StatusPill status="info" compact>
        {t('state.openPeriod')}
      </StatusPill>
    );
  };

  const desktop = (
    <PageBody>
      <PageHeader
        title={`${t('tab.support')} · ${monthLong(m.start, locale)} ${m.year}`}
        subtitle={t('billing.intro', {
          close: dayMonth(new Date(m.end.getTime() - 1), locale),
          send: dayMonth(m.end, locale),
        })}
        actions={
          <>
            <ButtonLink
              href={`/platform/finance/support/export?month=${m.key}`}
              variant="secondary"
              prefetch={false}
            >
              <Icon icon={Download} size={16} />
              {t('billing.exportLog')}
            </ButtonLink>
            <PreviewInvoicesButton
              month={m.key}
              firstTenantId={customers[0]?.tenantId ?? null}
              label={t('billing.preview')}
            />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero">
        <KpiCard
          hero
          icon={Headphones}
          label={t('billing.toBill', { month: monthLong(m.start, locale) })}
          growth={growthOf(
            growthPct(totals.gross, prevGross),
            (a) => t('billing.vsPrev', { pct: a, month: monthShort(prev.start, locale) }),
            locale,
          )}
          value={kr(totals.gross, locale)}
          unit="kr."
          visual={<HeroCurve data={series} />}
          footer={
            <span className="flex justify-between gap-2">
              <span>{t('billing.inclVat', { net: kr(totals.net, locale) })}</span>
              <span>
                {monthLong(prev.start, locale)} {kr(prevGross, locale)} kr.
              </span>
            </span>
          }
        />
        <KpiCard
          icon={Clock}
          label={t('billing.registered')}
          value={formatMinutes(totals.registered, locale)}
          visual={
            <Gauge percent={pct(totals.registered, projected)} label={t('billing.registered')} />
          }
          split={
            <KpiSplit
              left={{
                value: `${formatNumber(pct(totals.registered, projected), locale)} %`,
                suffix: t('kpi.ofForecast'),
              }}
              right={{ value: formatMinutes(projected, locale), suffix: t('kpi.forecast') }}
            />
          }
        />
        <KpiCard
          icon={Layers}
          label={t('billing.billedTime')}
          growth={growthOf(growthPct(totals.billed, prevBilled), (a) => `${a} %`, locale)}
          value={formatMinutes(totals.billed, locale)}
          split={
            <KpiSplit
              left={{
                value: formatMinutes(totals.registered, locale),
                suffix: t('billing.registeredShort'),
              }}
              right={{
                value: `+${formatMinutes(totals.billed - totals.registered, locale)}`,
                suffix: t('billing.rounding'),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: totals.registered, tone: 'ink' },
                { value: totals.billed - totals.registered, tone: 'hatch' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: t('billing.registeredShort') },
                {
                  tone: 'hatch',
                  label: t('billing.roundingPct', {
                    pct: formatNumber(
                      pct(totals.billed - totals.registered, totals.registered),
                      locale,
                    ),
                  }),
                },
              ]}
            />
          }
        />
        <KpiCard
          icon={UserRound}
          label={t('billing.customersWith')}
          value={formatNumber(customers.length, locale)}
          visual={<MiniBars items={customersPerMonth} />}
          footer={t('billing.ofCustomers', {
            count: live,
            pct: formatNumber(pct(customers.length, live), locale),
          })}
        />
        <KpiCard
          icon={CircleCheck}
          label={t('billing.rate')}
          value={formatNumber(
            pct(totals.registered, totals.registered + totals.nonBillable),
            locale,
          )}
          unit="%"
          split={
            <KpiSplit
              left={{
                value: formatMinutes(totals.registered, locale),
                suffix: t('billing.billable'),
              }}
              right={{
                value: formatMinutes(totals.nonBillable, locale),
                suffix: t('billing.notBillable'),
              }}
            />
          }
          visual={
            <SegmentBar
              compact
              segments={[
                { value: totals.registered, tone: 'ink' },
                { value: totals.nonBillable, tone: 'border' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: t('billing.billableLegend') },
                { tone: 'border', label: t('billing.notBillableLegend') },
              ]}
            />
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleLinks
            label={t('billing.month')}
            items={[
              {
                href: href({ month: shiftMonth(cur, -1).key, open: undefined }),
                label: monthLong(shiftMonth(cur, -1).start, locale),
                active: m.key === shiftMonth(cur, -1).key,
              },
              {
                href: href({ month: undefined, open: undefined }),
                label: monthLong(cur.start, locale),
                active: isOpen,
              },
            ]}
          />
          <QueryFilters
            searchLabel={t('billing.search')}
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
              {
                key: 'staff',
                label: t('billing.supporter'),
                allLabel: t('billing.allSupporters'),
                options: staffOptions,
              },
            ]}
          />
        </div>
        <span className="text-meta text-fg-2">{t('billing.sortedByAmount')}</span>
      </div>

      <Card padding="none" className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th className="w-10 pl-5" aria-label={t('billing.expand')} />
              <Th>{t('col.customer')}</Th>
              <Th>{t('col.plan')}</Th>
              <Th numeric>{t('col.registered')}</Th>
              <Th numeric>{t('col.billed')}</Th>
              <Th numeric>{t('col.amountInclVat')}</Th>
              <Th className="pr-5">{t('col.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const open = sp.open === c.tenantId;
              return [
                <Tr key={c.tenantId} interactive className={cn(open && 'bg-row-hover')}>
                  <Td className="pl-5">
                    <Link
                      href={href({ open: open ? undefined : c.tenantId })}
                      scroll={false}
                      aria-expanded={open}
                      aria-label={t(open ? 'billing.collapse' : 'billing.expandRow', {
                        name: c.tenantName,
                      })}
                      className="grid size-7 place-items-center rounded-full text-fg-1 hover:bg-bg-base"
                    >
                      <Icon icon={open ? ChevronDown : ChevronRight} size={16} />
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      href={`/platform/finance/support/${c.tenantId}?month=${m.key}`}
                      className="font-medium text-fg-1 no-underline"
                    >
                      <CustomerChip name={c.tenantName} />
                    </Link>
                  </Td>
                  <Td className="text-fg-2">
                    {c.planName} · {c.lines.length}
                  </Td>
                  <Td numeric>{formatMinutes(c.registered, locale)}</Td>
                  <Td numeric className="font-semibold">
                    {formatMinutes(c.billed, locale)}
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(c.grossOre, locale)}
                  </Td>
                  <Td className="pr-5">{statusOf(c)}</Td>
                </Tr>,
                ...(open
                  ? c.lines.map((l) => {
                      const e = c.entries.find((x) => x.caseId === l.caseId);
                      return (
                        <Tr key={`${c.tenantId}-${l.caseId}`} sub>
                          <Td sub className="pl-5" />
                          <Td sub colSpan={2}>
                            <span className="text-fg-2">#{l.caseNumber}</span>{' '}
                            {l.text.replace(/^#\d+\s*/, '')}
                          </Td>
                          <Td sub numeric>
                            {formatMinutes(l.registeredMinutes, locale)}
                          </Td>
                          <Td sub numeric>
                            <span className="mr-1 text-micro text-fg-2">
                              +{formatMinutes(l.billedMinutes - l.registeredMinutes, locale)}
                            </span>
                            {formatMinutes(l.billedMinutes, locale)}
                          </Td>
                          <Td sub numeric>
                            {money(Math.round(l.amountOre * 1.25), locale)}
                          </Td>
                          <Td sub className="pr-5">
                            {e?.caseResolvedAt ? (
                              <StatusPill status="paused" compact>
                                {t('billing.resolvedOn', {
                                  date: dayMonth(e.caseResolvedAt, locale),
                                })}
                              </StatusPill>
                            ) : (
                              <StatusPill status="ok" compact>
                                {t('billing.inProgress')}
                              </StatusPill>
                            )}
                          </Td>
                        </Tr>
                      );
                    })
                  : []),
              ];
            })}
            {customers.length === 0 && (
              <tr>
                <Td colSpan={7} className="px-5 text-fg-2">
                  {t('noSupport')}
                </Td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-navy text-on-navy">
              <td className="h-11 pl-5" />
              <td className="h-11 px-3 font-semibold">
                {t('billing.total', { count: customers.length })}
              </td>
              <td className="h-11 px-3 tabular">
                {t('billing.casesCount', { count: totals.cases })}
              </td>
              <td className="h-11 px-3 text-right font-semibold tabular">
                {formatMinutes(totals.registered, locale)}
              </td>
              <td className="h-11 px-3 text-right font-semibold tabular">
                {formatMinutes(totals.billed, locale)}
              </td>
              <td className="h-11 px-3 text-right font-semibold tabular">
                {money(totals.gross, locale)}
              </td>
              <td className="h-11 pr-5 pl-3 text-on-navy-muted">
                {t('billing.exVat', { amount: money(totals.net, locale) })}
              </td>
            </tr>
          </tfoot>
        </Table>
      </Card>
      <p className="m-0 text-meta text-fg-2">{t('billing.footnote')}</p>
    </PageBody>
  );
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const last = shiftMonth(cur, -1);
  const mobile = (
    <SettlementMobile
      d={{
        m,
        isOpen,
        rateOre: data.rateOre,
        totals,
        prevGross,
        prevBilled,
        series,
        customers,
        live,
        months: [
          {
            key: last.key,
            label: cap(monthLong(last.start, locale)),
            href: href({ month: last.key, open: undefined }),
          },
          {
            key: cur.key,
            label: cap(monthLong(cur.start, locale)),
            href: href({ month: undefined, open: undefined }),
          },
        ],
      }}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
