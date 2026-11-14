import { formatNumber, type Locale } from '@agentor/i18n';
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
import { CalendarDays, CircleCheck, Download, FileText, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Responsive } from '@agentor/ui/mobile';
import { ButtonLink } from '@/components/button-link';
import { NotifyButton } from '@/components/platform/finance/action-buttons';
import { CreditButton } from '@/components/platform/finance/credit-dialog';
import {
  CustomerChip,
  FilterChips,
  PanelHeader,
  dayMonth,
  growthOf,
  kr,
  money,
  monthLong,
  monthShort,
  monthYear,
  withParams,
} from '@/components/platform/finance/bits';
import { QueryFilters } from '@/components/platform/query-filters';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import {
  counted,
  currentMonth,
  daysBetween,
  financeInvoicesAll,
  growthPct,
  monthsBack,
  needsAction,
  parseMonth,
  paymentState,
  pct,
  shiftMonth,
  subscriptionRows,
  supportForMonth,
  type PaymentState,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { PaymentsMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance');
  return { title: t('tab.invoicing') };
}

const CHIPS = ['all', 'action', 'awaiting', 'paid'] as const;
type Chip = (typeof CHIPS)[number];

const inChip = (s: PaymentState, c: Chip) =>
  c === 'all' ||
  (c === 'action' ? needsAction(s) : c === 'awaiting' ? s === 'awaiting' : s === 'paid');

/** Finans · Fakturaer og betalinger (F6): overdue, reminders, failed cards and payments. */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; type?: string; month?: string; q?: string }>;
}) {
  const { actor } = await requireStaff(true);
  const sp = await searchParams;
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  const m = parseMonth(sp.month, now);
  const prev = shiftMonth(m, -1);
  const chip: Chip = (CHIPS as readonly string[]).includes(sp.f ?? '') ? (sp.f as Chip) : 'action';
  const [invoices, subs, support] = await Promise.all([
    financeInvoicesAll(actor),
    subscriptionRows(actor, now),
    supportForMonth(actor, cur),
  ]);
  const issuedIn = (mm: { start: Date; end: Date }) =>
    invoices.filter(
      (i) =>
        counted(i) &&
        (i.issuedAt ?? i.createdAt) >= mm.start &&
        (i.issuedAt ?? i.createdAt) < mm.end,
    );
  const monthInv = issuedIn(m);
  const gross = monthInv.reduce((a, i) => a + i.grossOre, 0);
  const prevGross = issuedIn(prev).reduce((a, i) => a + i.grossOre, 0);
  const series = monthsBack(m, 12).map((mm) => issuedIn(mm).reduce((a, i) => a + i.grossOre, 0));
  const paid = monthInv.filter((i) => i.status === 'paid');
  const paidGross = paid.reduce((a, i) => a + i.grossOre, 0);
  const prevPaidPct = pct(
    issuedIn(prev)
      .filter((i) => i.status === 'paid')
      .reduce((a, i) => a + i.grossOre, 0),
    prevGross,
  );
  const delays = paid
    .map((i) => daysBetween(i.issuedAt ?? i.createdAt, i.paidAt ?? i.createdAt))
    .sort((a, b) => a - b);
  const median = delays.length ? delays[Math.floor(delays.length / 2)]! : 0;
  const all = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const states = all.map((i) => ({ i, s: paymentState(i, now) }));
  const overdue = states.filter((x) => needsAction(x.s));
  const overdueGross = overdue.reduce((a, x) => a + x.i.grossOre, 0);
  const cardGross = overdue
    .filter((x) => x.i.paymentMethod !== 'invoice')
    .reduce((a, x) => a + x.i.grossOre, 0);
  const age = (x: (typeof overdue)[number]) => daysBetween(x.i.dueAt ?? x.i.createdAt, now);
  const nextRunList = subs
    .filter(
      (s) =>
        (s.status === 'active' || s.status === 'past_due') && s.state !== 'trial' && !s.cancelAt,
    )
    .filter(
      (s) => s.nextChargeAt && s.nextChargeAt < shiftMonth(cur, 1).end && s.nextChargeAt >= now,
    );
  const nextRunSubs = nextRunList.reduce((a, s) => a + Math.round(s.priceOre * 1.25), 0);
  const nextRunSupport = support.customers.reduce((a, c) => a + c.grossOre, 0);
  const nextRun = nextRunSubs + nextRunSupport;

  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = states
    .filter((x) => inChip(x.s, chip))
    .filter((x) => !sp.type || x.i.kind === sp.type)
    .filter(
      (x) =>
        chip === 'action' ||
        !sp.month ||
        ((x.i.issuedAt ?? x.i.createdAt) >= m.start && (x.i.issuedAt ?? x.i.createdAt) < m.end),
    )
    .filter(
      (x) =>
        !q ||
        x.i.tenantName.toLowerCase().includes(q) ||
        (x.i.number ?? '').toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        (b.i.issuedAt ?? b.i.createdAt).getTime() - (a.i.issuedAt ?? a.i.createdAt).getTime(),
    )
    .slice(0, 50);
  const counts = Object.fromEntries(
    CHIPS.map((c) => [c, states.filter((x) => inChip(x.s, c)).length]),
  ) as Record<Chip, number>;
  const latest = states
    .filter((x) => x.s === 'paid' && x.i.paidAt)
    .sort((a, b) => b.i.paidAt!.getTime() - a.i.paidAt!.getTime())
    .slice(0, 6);
  const base = { type: sp.type, month: sp.month, q: sp.q };
  const period = (i: (typeof invoices)[number]) => {
    if (i.kind === 'support') {
      const min = i.lines.reduce((a, l) => a + (l.billedMinutes ?? 0), 0);
      return `${monthYear(i.periodStart, locale)} · ${Math.floor(min / 60)} t${min % 60 ? ` ${min % 60} min.` : ''}`;
    }
    return `${i.description.split(' · ')[0]} · ${monthLong(i.periodStart, locale)}`;
  };
  const status = (x: (typeof states)[number]) => {
    const { i, s } = x;
    if (s === 'paid')
      return (
        <StatusPill status="ok">
          {t('state.paidBy', {
            method:
              i.paymentMethod === 'invoice' ? t('method.ean') : t(`method.${i.paymentMethod}`),
          })}
        </StatusPill>
      );
    if (s === 'retrying')
      return (
        <StatusPill status="warn">
          {t('state.retrying', { date: dayMonth(i.nextRetryAt!, locale) })}
        </StatusPill>
      );
    if (s === 'card_failed')
      return (
        <StatusPill status="error">{t('state.cardRefused', { count: i.attempts })}</StatusPill>
      );
    if (s === 'reminded')
      return <StatusPill status="error">{t('state.reminded', { count: i.reminders })}</StatusPill>;
    if (s === 'overdue')
      return (
        <StatusPill status="error">
          {t('state.overdueDays', { days: daysBetween(i.dueAt!, now) })}
        </StatusPill>
      );
    return <StatusPill status="info">{t('state.awaiting')}</StatusPill>;
  };
  const action = (x: (typeof states)[number]) => {
    const { i, s } = x;
    if (s === 'overdue' || s === 'reminded')
      return (
        <NotifyButton
          tenantId={i.tenantId}
          invoiceId={i.id}
          kind="reminder"
          label={i.reminders ? t('pay.reminderN', { n: i.reminders + 1 }) : t('pay.sendReminder')}
        />
      );
    if (s === 'card_failed' || s === 'retrying')
      return (
        <NotifyButton
          tenantId={i.tenantId}
          invoiceId={i.id}
          kind="payment_link"
          label={t('pay.sendLink')}
        />
      );
    return null;
  };

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('tab.invoicing')}
        subtitle={t('pay.intro')}
        actions={
          <ButtonLink href={`/platform/finance/invoicing/export?month=${m.key}`} prefetch={false}>
            <Icon icon={Download} size={16} />
            {t('pay.export')}
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          hero
          icon={FileText}
          label={t('pay.invoiced', { month: monthLong(m.start, locale) })}
          growth={growthOf(
            growthPct(gross, prevGross),
            (a) => t('billing.vsPrev', { pct: a, month: monthShort(prev.start, locale) }),
            locale,
          )}
          value={kr(gross, locale)}
          unit="kr."
          visual={<HeroCurve data={series} />}
          footer={
            <span className="flex justify-between gap-2">
              <span>{t('pay.inclVatFrom', { date: dayMonth(m.start, locale) })}</span>
              <span>
                {monthLong(prev.start, locale)} {kr(prevGross, locale)} kr.
              </span>
            </span>
          }
        />
        <KpiCard
          icon={CircleCheck}
          label={t('kpi.paid')}
          growth={growthOf(
            pct(paidGross, gross) - prevPaidPct,
            (a) => t('pay.ptVsPrev', { pt: a, month: monthShort(prev.start, locale) }),
            locale,
          )}
          value={`${formatNumber(pct(paidGross, gross), locale)} %`}
          visual={<Gauge percent={pct(paidGross, gross)} label={t('kpi.paid')} />}
          split={
            <KpiSplit
              left={{ value: `${kr(paidGross, locale)} kr.`, suffix: t('pay.paidShort') }}
              right={{ value: t('pay.days', { count: median }), suffix: t('pay.median') }}
            />
          }
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
                  text: t('pay.invoicesCount', { count: overdue.length }),
                } as const,
              }
            : {})}
          value={kr(overdueGross, locale)}
          unit="kr."
          split={
            <KpiSplit
              left={{ value: `${kr(cardGross, locale)} kr.`, suffix: t('pay.card') }}
              right={{
                value: `${kr(overdueGross - cardGross, locale)} kr.`,
                suffix: t('pay.invoiceOverdue'),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                {
                  value: overdue.filter((x) => age(x) <= 7).reduce((a, x) => a + x.i.grossOre, 0),
                  tone: 'warn',
                },
                {
                  value: overdue.filter((x) => age(x) > 7).reduce((a, x) => a + x.i.grossOre, 0),
                  tone: 'error',
                },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'warn', label: t('pay.age1') },
                { tone: 'error', label: t('pay.age2') },
              ]}
            />
          }
        />
        <KpiCard
          icon={CalendarDays}
          label={t('pay.nextRun', { date: dayMonth(cur.end, locale) })}
          growth={growthOf(
            growthPct(nextRun, gross),
            (a) => t('billing.vsPrev', { pct: a, month: monthShort(cur.start, locale) }),
            locale,
          )}
          value={kr(nextRun, locale)}
          unit="kr."
          split={
            <KpiSplit
              left={{
                value: `${kr(nextRunSubs, locale)} kr.`,
                suffix: t('pay.subsCount', { count: subs.length }),
              }}
              right={{
                value: `${kr(nextRunSupport, locale)} kr.`,
                suffix: t('pay.supportCount', { count: support.customers.length }),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: nextRunSubs, tone: 'ink' },
                { value: nextRunSupport, tone: 'hatch' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: t('kind.subscription') },
                { tone: 'hatch', label: t('kind.support') },
              ]}
            />
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label={t('sub.filters')}
          items={CHIPS.map((c) => ({
            href: withParams('/platform/finance/invoicing', {
              ...base,
              f: c === 'action' ? undefined : c,
            }),
            label:
              c === 'all' || c === 'paid'
                ? t(`pay.chip.${c}`)
                : `${t(`pay.chip.${c}`)} · ${counts[c]}`,
            active: chip === c,
          }))}
        />
        <QueryFilters
          searchLabel={t('pay.search')}
          filters={[
            {
              key: 'type',
              label: t('col.type'),
              allLabel: t('pay.allTypes'),
              options: [
                { value: 'subscription', label: t('kind.subscription') },
                { value: 'support', label: t('kind.support') },
              ],
            },
            {
              key: 'month',
              label: monthYear(m.start, locale),
              allLabel: monthYear(cur.start, locale),
              options: monthsBack(cur, 12)
                .reverse()
                .slice(1)
                .map((mm) => ({ value: mm.key, label: monthYear(mm.start, locale) })),
            },
          ]}
        />
      </div>

      <Card padding="none">
        <Table>
          <thead>
            <tr>
              <Th className="pl-5">{t('col.number')}</Th>
              <Th>{t('col.customer')}</Th>
              <Th>{t('col.type')}</Th>
              <Th>{t('col.period')}</Th>
              <Th>{t('col.issued')}</Th>
              <Th>{t('due')}</Th>
              <Th numeric>{t('draft.amount')}</Th>
              <Th>{t('col.status')}</Th>
              <Th className="pr-5" aria-label={t('col.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <Tr key={x.i.id} interactive>
                <Td className="pl-5 font-mono">{x.i.number}</Td>
                <Td>
                  <Link
                    href={`/platform/finance/customers/${x.i.tenantId}`}
                    className="text-fg-1 no-underline"
                  >
                    <CustomerChip name={x.i.tenantName} />
                  </Link>
                </Td>
                <Td>{x.i.kind === 'support' ? t('kind.support') : t('kind.subscription')}</Td>
                <Td className="text-fg-2">{period(x.i)}</Td>
                <Td>{dayMonth(x.i.issuedAt ?? x.i.createdAt, locale)}</Td>
                <Td>{x.i.dueAt ? dayMonth(x.i.dueAt, locale) : '–'}</Td>
                <Td numeric>{money(x.i.grossOre, locale)}</Td>
                <Td>{status(x)}</Td>
                <Td className="pr-5 text-right">
                  <span className="inline-flex gap-2">
                    {action(x)}
                    {x.i.number && (
                      <CreditButton
                        tenantId={x.i.tenantId}
                        invoiceId={x.i.id}
                        number={x.i.number}
                      />
                    )}
                  </span>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <Td colSpan={9} className="px-5 text-fg-2">
                  {t('pay.none')}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card padding="none">
        <PanelHeader
          title={t('pay.latest')}
          action={<span className="text-meta text-fg-2">{t('pay.latestFrom')}</span>}
        />
        <Table>
          <thead>
            <tr>
              <Th className="pl-5">{t('col.number')}</Th>
              <Th>{t('col.customer')}</Th>
              <Th>{t('col.type')}</Th>
              <Th>{t('col.period')}</Th>
              <Th>{t('col.issued')}</Th>
              <Th>{t('kpi.paid')}</Th>
              <Th numeric>{t('draft.amount')}</Th>
              <Th>{t('col.status')}</Th>
              <Th className="pr-5" aria-label={t('col.actions')} />
            </tr>
          </thead>
          <tbody>
            {latest.map((x) => (
              <Tr key={x.i.id}>
                <Td className="pl-5 font-mono">{x.i.number}</Td>
                <Td>
                  <CustomerChip name={x.i.tenantName} />
                </Td>
                <Td>{x.i.kind === 'support' ? t('kind.support') : t('kind.subscription')}</Td>
                <Td className="text-fg-2">{period(x.i)}</Td>
                <Td>{dayMonth(x.i.issuedAt ?? x.i.createdAt, locale)}</Td>
                <Td>{dayMonth(x.i.paidAt!, locale)}</Td>
                <Td numeric>{money(x.i.grossOre, locale)}</Td>
                <Td>{status(x)}</Td>
                <Td className="pr-5 text-right">
                  {x.i.number && (
                    <CreditButton tenantId={x.i.tenantId} invoiceId={x.i.id} number={x.i.number} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </PageBody>
  );
  const methodOf = (i: (typeof invoices)[number]) =>
    i.paymentMethod === 'invoice' ? t('method.ean') : t(`method.${i.paymentMethod}`);
  const mobileRow = (x: (typeof states)[number]) => ({
    id: x.i.id,
    tenantId: x.i.tenantId,
    name: x.i.tenantName,
    meta: [
      x.i.number,
      `${x.i.kind === 'support' ? t('kind.support') : x.i.description.split(' · ')[0]} ${monthLong(x.i.periodStart, locale)}`,
      methodOf(x.i),
    ]
      .filter(Boolean)
      .join(' · '),
    amount: x.i.grossOre,
    status: status(x),
  });
  const cardsRefused = overdue.filter((x) => x.s === 'card_failed' || x.s === 'retrying').length;
  const mobile = (
    <PaymentsMobile
      d={{
        exportHref: `/platform/finance/invoicing/export?month=${m.key}`,
        invoicedLabel: t('pay.invoiced', { month: monthShort(m.start, locale) }),
        invoicedTrend: growthOf(growthPct(gross, prevGross), (a) => `${a} %`, locale),
        gross,
        prevGross,
        prevMonth: monthLong(prev.start, locale),
        series,
        paidGross,
        median,
        overdueGross,
        overdueCount: overdue.length,
        cardsRefused,
        pastDue: overdue.length - cardsRefused,
        nextRunDate: cur.end,
        nextRun,
        nextRunSubs: nextRunList.length,
        nextRunSupport: support.customers.length,
        chip,
        chips: (['action', 'awaiting', 'paid', 'all'] as const).map((c) => ({
          key: c,
          href: withParams('/platform/finance/invoicing', {
            ...base,
            f: c === 'action' ? undefined : c,
          }),
          label:
            c === 'all' || c === 'paid' ? t(`pay.chip.${c}`) : `${t(`pay.chip.${c}`)} ${counts[c]}`,
        })),
        rows: rows.map(mobileRow),
        latest: latest.map(mobileRow),
      }}
    />
  );
  return <Responsive desktop={desktop} mobile={mobile} />;
}
