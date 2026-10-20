import { formatNumber, type Locale } from '@agentor/i18n';
import type { Growth } from '@agentor/ui';
import {
  ChipGroup,
  MobileCard,
  MobileEmpty,
  MobileKpi,
  MobileLogo,
  MobileRing,
  MobileShell,
  Row,
  RowIcon,
  RowLink,
  SectionHeading,
  StackedValue,
  TopBarAction,
} from '@agentor/ui/mobile';
import { CircleCheck, Download, ReceiptText, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { dayMonth, kr, money } from '@/components/platform/finance/bits';
import { KpiPair, KrValue, SmallKpi } from '@/components/platform/finance/mobile-bits';

export interface PaymentRow {
  id: string;
  tenantId: string;
  name: string;
  meta: string;
  amount: number;
  status: ReactNode;
}

export interface PaymentsMobileData {
  exportHref: string;
  invoicedLabel: string;
  invoicedTrend: Growth | undefined;
  gross: number;
  prevGross: number;
  prevMonth: string;
  series: number[];
  paidGross: number;
  median: number;
  overdueGross: number;
  overdueCount: number;
  cardsRefused: number;
  pastDue: number;
  nextRunDate: Date;
  nextRun: number;
  nextRunSubs: number;
  nextRunSupport: number;
  chip: 'all' | 'action' | 'awaiting' | 'paid';
  chips: { key: string; label: string; href: string }[];
  rows: PaymentRow[];
  latest: PaymentRow[];
}

const OVERDUE = '/platform/finance/invoices?status=overdue';

/** MP22 Fakturaer og betalinger (F6): key figures, what needs action, and recent payments. */
export async function PaymentsMobile({ d }: { d: PaymentsMobileData }) {
  const t = await getTranslations('mobile.payments');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const krs = (ore: number) => `${kr(ore, locale)} kr.`;
  const paidPct = d.gross ? (d.paidGross / d.gross) * 100 : 0;
  const row = (r: PaymentRow) => (
    <RowLink
      key={r.id}
      href={`/platform/finance/customers/${r.tenantId}`}
      linkAs={Link}
      leading={<MobileLogo name={r.name} size={32} />}
      title={r.name}
      meta={r.meta}
      trailing={<StackedValue value={money(r.amount, locale)} pill={r.status} />}
    />
  );
  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/finance"
          title={tf('tab.payments')}
          subtitle={t('subtitle')}
          bell={false}
          actions={
            <TopBarAction icon={Download} label={tf('pay.export')} href={d.exportHref} onNavy />
          }
        />
      }
    >
      <KpiPair>
        <MobileKpi
          featured
          label={d.invoicedLabel}
          trend={d.invoicedTrend}
          value={<KrValue value={kr(d.gross, locale)} />}
          data={d.series}
          meta={t('invoicedMeta', { month: d.prevMonth, amount: kr(d.prevGross, locale) })}
        />
        <MobileRing
          label={tf('kpi.paid')}
          ratio={paidPct / 100}
          percentLabel={`${formatNumber(paidPct, locale)} %`}
          value={kr(d.paidGross, locale)}
          of={t('of', { amount: kr(d.gross, locale) })}
          meta={t('median', { days: tf('pay.days', { count: d.median }) })}
        />
      </KpiPair>
      <KpiPair>
        <SmallKpi
          label={tf('kpi.overdue')}
          {...(d.overdueCount
            ? {
                trend: {
                  direction: 'down',
                  tone: 'bad',
                  text: tf('kpi.invoices', { count: d.overdueCount }),
                } as const,
              }
            : {})}
          value={krs(d.overdueGross)}
          meta={t('overdueMeta', { cards: d.cardsRefused, overdue: d.pastDue })}
        />
        <SmallKpi
          label={tf('pay.nextRun', { date: dayMonth(d.nextRunDate, locale) })}
          value={krs(d.nextRun)}
          meta={t('nextRunMeta', { subs: d.nextRunSubs, support: d.nextRunSupport })}
        />
      </KpiPair>
      <ChipGroup
        label={tf('sub.filters')}
        linkAs={Link}
        value={d.chip}
        items={d.chips.map((c) => ({ key: c.key, label: c.label, href: c.href }))}
      />
      {d.chip === 'action' ? (
        d.overdueCount === 0 ? (
          <MobileEmpty icon={CircleCheck} title={tf('nothingNeeded')} />
        ) : (
          <MobileCard>
            <RowLink
              href={OVERDUE}
              linkAs={Link}
              leading={<RowIcon icon={TriangleAlert} tone="error" />}
              title={t('needsAction', { count: d.overdueCount })}
              meta={t('needsActionMeta', { amount: money(d.overdueGross, locale) })}
            />
          </MobileCard>
        )
      ) : d.rows.length === 0 ? (
        <MobileEmpty icon={ReceiptText} title={tf('pay.none')} />
      ) : (
        <MobileCard>{d.rows.map(row)}</MobileCard>
      )}
      <SectionHeading>{tf('pay.latest')}</SectionHeading>
      {d.latest.length === 0 ? (
        <MobileEmpty icon={ReceiptText} title={t('noPayments')} />
      ) : (
        <MobileCard>
          {d.latest.map((r) => (
            <Row
              key={r.id}
              leading={<MobileLogo name={r.name} size={32} />}
              title={r.name}
              meta={r.meta}
              trailing={<StackedValue value={money(r.amount, locale)} pill={r.status} />}
            />
          ))}
        </MobileCard>
      )}
    </MobileShell>
  );
}
