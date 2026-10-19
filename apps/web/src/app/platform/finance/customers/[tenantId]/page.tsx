import { isUuid } from '@agentor/db';
import { formatMinutes, type Locale } from '@agentor/i18n';
import {
  Card,
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
  type SegmentTone,
} from '@agentor/ui';
import { ArrowLeft, CalendarClock, CreditCard, Download, Headphones, Layers } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/button-link';
import { StatementButton } from '@/components/platform/finance/action-buttons';
import {
  PanelHeader,
  dayMonth,
  growthOf,
  kr,
  money,
  monthLong,
  monthShort,
  monthYear,
} from '@/components/platform/finance/bits';
import { PageBody } from '@/components/shell/secondary-nav';
import {
  counted,
  currentMonth,
  financeInvoicesAll,
  growthPct,
  monthsBack,
  paymentState,
  shiftMonth,
  subscriptionRows,
  supportForMonth,
} from '@/server/finance-data';
import { initials } from '@/server/platform-data';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.finance.customer');
  return { title: t('title') };
}

const CASE_TONES: SegmentTone[] = ['ink', 'hatch', 'navy', 'border'];

/** Kundeøkonomi (F4): one customer's subscription, support and invoices. */
export default async function CustomerFinancePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { actor } = await requireStaff(true);
  const { tenantId } = await params;
  if (!isUuid(tenantId)) notFound();
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const cur = currentMonth(now);
  const prev = shiftMonth(cur, -1);
  const [subs, all, support] = await Promise.all([
    subscriptionRows(actor, now),
    financeInvoicesAll(actor),
    supportForMonth(actor, cur),
  ]);
  const sub = subs.find((s) => s.tenantId === tenantId);
  if (!sub) notFound();
  const invoices = all
    .filter((i) => i.tenantId === tenantId)
    .sort((a, b) => (b.issuedAt ?? b.createdAt).getTime() - (a.issuedAt ?? a.createdAt).getTime());
  const months = monthsBack(cur, 12);
  const yearStart =
    months.find((m) => m.month === 1 && m.year === cur.year)?.start ?? months[0]!.start;
  const ytd = invoices.filter((i) => counted(i) && (i.issuedAt ?? i.createdAt) >= yearStart);
  const ytdNet = ytd.reduce((a, i) => a + i.netOre, 0);
  const ytdSubs = ytd.filter((i) => i.kind === 'subscription').reduce((a, i) => a + i.netOre, 0);
  const lastYear = invoices
    .filter((i) => counted(i) && (i.issuedAt ?? i.createdAt) < yearStart)
    .reduce((a, i) => a + i.netOre, 0);
  let running = 0;
  const curve = months.map((m) => {
    running += invoices
      .filter(
        (i) =>
          counted(i) &&
          (i.issuedAt ?? i.createdAt) >= m.start &&
          (i.issuedAt ?? i.createdAt) < m.end,
      )
      .reduce((a, i) => a + i.netOre, 0);
    return running;
  });
  const mine = support.customers.find((c) => c.tenantId === tenantId);
  const prevSupport = invoices
    .filter((i) => i.kind === 'support' && i.periodStart.getTime() === prev.start.getTime())
    .reduce((a, i) => a + i.grossOre, 0);
  const supportMinutes = (m: { start: Date }) =>
    invoices
      .filter(
        (i) => i.kind === 'support' && counted(i) && i.periodStart.getTime() === m.start.getTime(),
      )
      .reduce((a, i) => a + i.lines.reduce((b, l) => b + (l.billedMinutes ?? 0), 0), 0);
  const bars = monthsBack(cur, 6).map((m, i, arr) => ({
    label: monthShort(m.start, locale),
    value: i === arr.length - 1 ? (mine?.billed ?? 0) : supportMinutes(m),
  }));
  const yearMinutes =
    months.filter((m) => m.start >= yearStart).reduce((a, m) => a + supportMinutes(m), 0) +
    (mine?.billed ?? 0);
  const yearSupportGross =
    invoices
      .filter((i) => i.kind === 'support' && counted(i) && i.periodStart >= yearStart)
      .reduce((a, i) => a + i.grossOre, 0) + (mine?.grossOre ?? 0);
  const periodMonths = sub.interval === 'year' ? 12 : 1;
  const used =
    sub.currentPeriodStart && sub.currentPeriodEnd
      ? Math.min(
          periodMonths,
          Math.max(
            0,
            Math.round(
              ((now.getTime() - sub.currentPeriodStart.getTime()) /
                (sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime())) *
                periodMonths,
            ),
          ),
        )
      : 0;
  const card =
    sub.paymentMethod === 'invoice'
      ? `${t('sub.invoiceEan')}${sub.ean ? ` ${sub.ean}` : ''}`
      : sub.paymentMethod === 'mobilepay'
        ? 'MobilePay'
        : `${sub.cardBrand === 'mastercard' ? 'Mastercard' : 'Visa'} •••• ${sub.cardLast4 ?? ''}`;
  const pill = (i: (typeof invoices)[number]) => {
    const s = paymentState(i, now);
    if (s === 'paid')
      return (
        <StatusPill status="ok">
          {t('state.paidOn', { date: dayMonth(i.paidAt ?? i.issuedAt ?? now, locale) })}
        </StatusPill>
      );
    if (s === 'draft')
      return (
        <StatusPill status="info" compact>
          {t('state.sendsOn', { date: dayMonth(i.sendAt ?? cur.end, locale) })}
        </StatusPill>
      );
    if (s === 'awaiting') return <StatusPill status="info">{t('state.awaiting')}</StatusPill>;
    if (s === 'retrying' || s === 'card_failed')
      return (
        <StatusPill status="error">{t('state.cardRefused', { count: i.attempts })}</StatusPill>
      );
    return (
      <StatusPill status="error">
        {t('state.overdueDays', {
          days: Math.max(0, Math.floor((now.getTime() - (i.dueAt ?? now).getTime()) / 86_400_000)),
        })}
      </StatusPill>
    );
  };
  const draftRow = mine && !mine.invoice ? mine : null;

  return (
    <PageBody>
      <Link
        href="/platform/finance/subscriptions"
        className="inline-flex items-center gap-2 text-table font-medium text-fg-1 no-underline"
      >
        <Icon icon={ArrowLeft} size={16} />
        {t('tab.subscriptions')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-sm bg-bg-base text-card font-semibold shadow-ring-chip">
            {initials(sub.tenantName)}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-page">{sub.tenantName}</h1>
            <p className="m-0 text-fg-2">
              {[
                sub.cvr ? `CVR ${sub.cvr}` : null,
                t('customer.since', {
                  date: dayMonth(sub.customerSince, locale) + ' ' + sub.customerSince.getFullYear(),
                }),
                sub.billingEmail ? t('customer.invoiceTo', { email: sub.billingEmail }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href={`/platform/customers/${tenantId}`}>{t('customer.profile')}</ButtonLink>
          <StatementButton tenantId={tenantId} label={t('customer.statement')} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          hero
          icon={CalendarClock}
          label={t('customer.revenueYear')}
          growth={growthOf(
            growthPct(ytdNet, lastYear),
            (a) => t('customer.vsLastYear', { pct: a, year: cur.year - 1 }),
            locale,
          )}
          value={kr(ytdNet, locale)}
          unit="kr."
          visual={<HeroCurve data={curve} />}
          footer={
            <span className="flex justify-between gap-2">
              <span>{t('customer.exVatSubs', { amount: kr(ytdSubs, locale) })}</span>
              <span>
                {t('kind.support')} {kr(ytdNet - ytdSubs, locale)}
              </span>
            </span>
          }
        />
        <KpiCard
          icon={CreditCard}
          label={t('kind.subscription')}
          growth={{
            direction: 'flat',
            tone: sub.state === 'failed' ? 'bad' : sub.state === 'paid' ? 'good' : 'neutral',
            text: t(`state.${sub.state === 'renews' ? 'paid' : sub.state}`),
          }}
          value={sub.planName}
          split={
            <KpiSplit
              left={{
                value: `${kr(sub.priceOre, locale)} kr.${sub.interval === 'year' ? t('perYearShort') : t('perMonthShort')}`,
                suffix: sub.interval === 'year' ? t('sub.yearly') : t('sub.monthly'),
              }}
              right={{
                value: sub.nextChargeAt ? dayMonth(sub.nextChargeAt, locale) : '–',
                suffix: t('customer.next'),
              }}
            />
          }
          visual={
            <SegmentBar
              segments={[
                { value: used, tone: 'ink' },
                { value: periodMonths - used, tone: 'muted' },
              ]}
            />
          }
          footer={
            <KpiLegend
              items={[
                { tone: 'ink', label: t('customer.monthsUsed', { used, total: periodMonths }) },
                { tone: 'muted', label: card },
              ]}
            />
          }
        />
        <KpiCard
          icon={Headphones}
          label={t('customer.supportIn', { month: monthLong(cur.start, locale) })}
          growth={growthOf(
            growthPct(mine?.grossOre ?? 0, prevSupport),
            (a) => t('billing.vsPrev', { pct: a, month: monthShort(prev.start, locale) }),
            locale,
          )}
          value={kr(mine?.grossOre ?? 0, locale)}
          unit="kr."
          split={
            <KpiSplit
              left={{
                value: formatMinutes(mine?.registered ?? 0, locale),
                suffix: t('billing.registeredShort'),
              }}
              right={{ value: formatMinutes(mine?.billed ?? 0, locale), suffix: t('col.billed') }}
            />
          }
          visual={
            <SegmentBar
              segments={(mine?.lines ?? []).map((l, i) => ({
                value: l.billedMinutes,
                tone: CASE_TONES[i % CASE_TONES.length]!,
              }))}
            />
          }
          footer={
            <KpiLegend
              items={(mine?.lines ?? []).slice(0, 4).map((l, i) => ({
                tone: CASE_TONES[i % CASE_TONES.length]!,
                label: `#${l.caseNumber}`,
              }))}
            />
          }
        />
        <KpiCard
          icon={Layers}
          label={t('customer.supportPerMonth')}
          value={formatMinutes(yearMinutes, locale)}
          visual={<MiniBars items={bars} />}
          footer={t('customer.supportYear', { amount: kr(yearSupportGross, locale) })}
        />
      </div>

      <Card padding="none">
        <PanelHeader
          title={t('customer.invoices')}
          action={<span className="text-meta text-fg-2">{t('customer.inclVat')}</span>}
        />
        <Table>
          <thead>
            <tr>
              <Th className="pl-5">{t('col.number')}</Th>
              <Th>{t('col.issued')}</Th>
              <Th>{t('col.type')}</Th>
              <Th>{t('col.period')}</Th>
              <Th numeric>{t('col.time')}</Th>
              <Th numeric>{t('draft.amount')}</Th>
              <Th>{t('col.status')}</Th>
              <Th className="pr-5" aria-label={t('col.actions')} />
            </tr>
          </thead>
          <tbody>
            {draftRow && (
              <Tr className="bg-row-hover">
                <Td className="pl-5 font-mono">{t('state.draft')}</Td>
                <Td>{dayMonth(cur.end, locale)}</Td>
                <Td>{t('kind.support')}</Td>
                <Td>{monthYear(cur.start, locale)}</Td>
                <Td numeric>{formatMinutes(draftRow.billed, locale)}</Td>
                <Td numeric>{money(draftRow.grossOre, locale)}</Td>
                <Td>
                  <StatusPill status="info" compact>
                    {t('state.sendsOn', { date: dayMonth(cur.end, locale) })}
                  </StatusPill>
                </Td>
                <Td className="pr-5 text-right">
                  <ButtonLink
                    size="s"
                    href={`/platform/finance/support/${tenantId}?month=${cur.key}`}
                  >
                    {t('customer.open')}
                  </ButtonLink>
                </Td>
              </Tr>
            )}
            {invoices.map((i) => (
              <Tr key={i.id}>
                <Td className="pl-5 font-mono">{i.number ?? t('state.draft')}</Td>
                <Td>
                  {dayMonth(i.issuedAt ?? i.sendAt ?? i.createdAt, locale)}{' '}
                  {(i.issuedAt ?? i.createdAt).getFullYear()}
                </Td>
                <Td>{i.kind === 'support' ? t('kind.support') : t('kind.subscription')}</Td>
                <Td>{i.kind === 'support' ? monthYear(i.periodStart, locale) : i.description}</Td>
                <Td numeric>
                  {i.kind === 'support'
                    ? formatMinutes(
                        i.lines.reduce((a, l) => a + (l.billedMinutes ?? 0), 0),
                        locale,
                      )
                    : '–'}
                </Td>
                <Td numeric>{money(i.grossOre, locale)}</Td>
                <Td>{pill(i)}</Td>
                <Td className="pr-5 text-right">
                  {i.status === 'draft' ? (
                    <ButtonLink
                      size="s"
                      href={`/platform/finance/support/${tenantId}?month=${cur.key}`}
                    >
                      {t('customer.open')}
                    </ButtonLink>
                  ) : (
                    <ButtonLink
                      size="s"
                      href={`/platform/finance/invoices/${tenantId}/${i.id}/pdf`}
                      prefetch={false}
                      aria-label={t('customer.pdfOf', { number: i.number ?? '' })}
                    >
                      <Icon icon={Download} size={14} />
                      PDF
                    </ButtonLink>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </PageBody>
  );
}
