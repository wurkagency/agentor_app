import { formatNumber, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ChipGroup,
  ExpandCard,
  KV,
  MobileEmpty,
  MobileFootnote,
  MobileKpi,
  MobileLogo,
  MobileRing,
  MobileShell,
} from '@agentor/ui/mobile';
import { Repeat } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { growthOf, kr, monthYear, withParams } from '@/components/platform/finance/bits';
import { MobileDiscount } from '@/components/platform/finance/mobile-actions';
import { KpiPair, KrValue, SmallKpi } from '@/components/platform/finance/mobile-bits';
import { growthPct, pct, type SubRow } from '@/server/finance-data';

const BASE = '/platform/finance/subscriptions';
const CHIPS = ['all', 'problems', 'year', 'trial'] as const;

export interface SubscriptionsMobileData {
  month: Date;
  mrr: number;
  /** Yearly recurring revenue for the last 12 months, the last one live. */
  series: number[];
  live: number;
  startup: number;
  trials: number;
  /** Share of ended trials that became customers, or null without any. */
  conversion: number | null;
  churn: number;
  churnBefore: number;
  cancelled30: number;
  filter: string;
  counts: Record<(typeof CHIPS)[number], number>;
  rows: {
    s: SubRow;
    status: ComponentProps<typeof StatusPill>['status'];
    label: string;
    next: string;
    method: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
  /** Other query parameters to keep on the chips and pages. */
  params: { q?: string | undefined; plan?: string | undefined; f?: string | undefined };
  discountCustomers: { tenantId: string; name: string; discountPct: number | null }[];
}

/** MP18 Abonnementer (F2): key figures, filter chips and one foldable row per customer. */
export async function SubscriptionsMobile({ d }: { d: SubscriptionsMobileData }) {
  const t = await getTranslations('mobile.subscriptions');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const arr = d.mrr * 12;
  const startupPct = pct(d.startup, d.live);
  const interval = (s: SubRow) =>
    s.state === 'trial'
      ? tf('state.trial')
      : s.interval === 'year'
        ? tf('sub.yearly')
        : tf('sub.monthly');
  const price = (s: SubRow) =>
    s.state === 'trial'
      ? '0 kr.'
      : `${kr(s.priceOre, locale)} kr.${s.interval === 'year' ? tf('perYearShort') : tf('perMonthShort')}`;
  const pageHref = (page: number) =>
    withParams(BASE, { ...d.params, page: page > 1 ? String(page) : undefined });
  const pager: ReactNode[] = [];
  if (d.page > 1)
    pager.push(
      <CardButton key="prev" href={pageHref(d.page - 1)} linkAs={Link}>
        {tf('previous')}
      </CardButton>,
    );
  if (d.page * d.pageSize < d.total)
    pager.push(
      <CardButton key="next" href={pageHref(d.page + 1)} linkAs={Link}>
        {tf('next')}
      </CardButton>,
    );

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/finance"
          title={tf('tab.subscriptions')}
          subtitle={monthYear(d.month, locale)}
          bell={false}
          actions={<MobileDiscount customers={d.discountCustomers} />}
        />
      }
    >
      <KpiPair>
        <MobileKpi
          featured
          label={t('arr')}
          trend={growthOf(
            growthPct(d.series.at(-1) ?? 0, d.series[0] ?? 0),
            (a) => `${a} %`,
            locale,
          )}
          value={<KrValue value={kr(arr, locale)} />}
          data={d.series}
          meta={tf('kpi.perMonthAmount', { amount: kr(d.mrr, locale) })}
        />
        <MobileRing
          label={tf('kpi.subscriptions')}
          ratio={startupPct / 100}
          percentLabel={`${formatNumber(startupPct, locale)} %`}
          value={formatNumber(d.live, locale)}
          of={t('startup', { count: d.startup })}
          meta={t('businessEnterprise', { count: d.live - d.startup })}
        />
      </KpiPair>
      <KpiPair>
        <SmallKpi
          label={tf('kpi.trials')}
          value={formatNumber(d.trials, locale)}
          meta={
            d.conversion === null
              ? t('noConversion')
              : t('conversion', { pct: formatNumber(d.conversion, locale) })
          }
        />
        <SmallKpi
          label={tf('kpi.churn')}
          trend={growthOf(d.churn - d.churnBefore, (a) => t('pt', { pt: a }), locale, false)}
          value={`${formatNumber(d.churn, locale, 1)} %`}
          meta={t('cancelled30', { count: d.cancelled30 })}
        />
      </KpiPair>

      <ChipGroup
        label={tf('sub.filters')}
        linkAs={Link}
        value={d.filter}
        items={CHIPS.map((c) => ({
          key: c,
          href: withParams(BASE, {
            q: d.params.q,
            plan: d.params.plan,
            f: c === 'all' ? undefined : c,
          }),
          label: `${c === 'trial' ? t('trialChip') : tf(`sub.filter.${c}`)} ${d.counts[c]}`,
        }))}
      />

      {d.rows.length === 0 ? (
        <MobileEmpty icon={Repeat} title={t('none')} />
      ) : (
        d.rows.map(({ s, status, label, next, method }, i) => (
          <ExpandCard
            key={s.id}
            open={i === 0 && (s.state === 'failed' || s.state === 'card_expiring')}
            leading={<MobileLogo name={s.tenantName} size={32} />}
            title={s.tenantName}
            meta={`${s.planName} · ${interval(s)} · ${price(s)}`}
            trailing={<StatusPill status={status}>{label}</StatusPill>}
          >
            <KV k={tf('col.plan')}>{s.planName}</KV>
            <KV k={tf('col.interval')}>{interval(s)}</KV>
            <KV k={tf('col.priceExVat')}>
              {price(s)}
              {s.discountPct ? (
                <span className="block text-micro text-fg-2">
                  {tf('sub.discount', { pct: s.discountPct })}
                </span>
              ) : null}
            </KV>
            <KV k={tf('col.nextCharge')}>{next}</KV>
            <KV k={tf('col.method')}>{method}</KV>
            <CardActions>
              <CardButton href={`/platform/finance/customers/${s.tenantId}`} linkAs={Link}>
                {t('finances')}
              </CardButton>
            </CardActions>
          </ExpandCard>
        ))
      )}
      {pager.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-fg-2">
            {tf('sub.showing', { shown: d.rows.length, total: d.total })}
          </span>
          <span className="flex gap-2">{pager}</span>
        </div>
      )}
      <MobileFootnote>{tf('sub.footnote')}</MobileFootnote>
    </MobileShell>
  );
}
