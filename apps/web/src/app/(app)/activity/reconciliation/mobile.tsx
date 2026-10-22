import { formatDate, formatMoney, formatNumber, type Locale } from '@agentor/i18n';
import { StatusPill } from '@agentor/ui';
import {
  CardActions,
  CardButton,
  ChipGroup,
  ExpandCard,
  KV,
  MobileCard,
  MobileEmpty,
  MobileFootnote,
  MobilePageTitle,
  MobileShell,
} from '@agentor/ui/mobile';
import { Scale } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import { RetryFailedButton } from '../../integrations/[id]/runs/retry-button';
import { MobileFlowSelect } from './mobile-flow-select';

export interface ReconDay {
  day: string;
  sourceCount: number;
  sourceAmount: number;
  destCount: number;
  destAmount: number;
  missing: string[];
}

/** MA28 Afstemning: totals for the period and one foldable row per day (D10-Afstemning). */
export async function ReconciliationMobile({
  flow,
  flows,
  days,
  period,
  src,
  dest,
  canEdit,
}: {
  flow: { id: string; name: string } | null;
  flows: { id: string; name: string }[];
  days: ReconDay[];
  period: '7d' | '30d';
  src: string;
  dest: string;
  canEdit: boolean;
}) {
  const t = await getTranslations('reconciliation');
  const tm = await getTranslations('mobile.reconciliation');
  const locale = (await getLocale()) as Locale;
  const topBar = <AppTopBar back="/activity" title={t('title')} />;
  if (!flow)
    return (
      <MobileShell topBar={topBar}>
        <MobilePageTitle title={t('title')} subtitle={tm('subtitle')} />
        <MobileEmpty icon={Scale} title={t('emptyTitle')}>
          {t('emptyBody')}
        </MobileEmpty>
      </MobileShell>
    );

  const money = (ore: number) => formatMoney(ore / 100, locale);
  const sum = (k: 'sourceCount' | 'destCount' | 'sourceAmount' | 'destAmount') =>
    days.reduce((s, d) => s + d[k], 0);
  const diff = sum('sourceCount') - sum('destCount');
  const today = new Date().toISOString().slice(0, 10);
  const firstOff = days.find((d) => d.sourceCount - d.destCount > 0);
  const missingToday = days[0]?.day === today ? days[0].missing : [];
  const href = (p: '7d' | '30d') => `/activity/reconciliation?flow=${flow.id}&period=${p}`;

  return (
    <MobileShell topBar={topBar}>
      <MobilePageTitle title={t('title')} subtitle={tm('subtitle')} />
      <MobileFlowSelect
        flows={flows}
        value={flow.id}
        label={t('flowLabel')}
        {...(period === '30d' ? { period } : {})}
      />
      <ChipGroup
        label={tm('period')}
        value={period}
        linkAs={Link}
        items={[
          { key: '7d', label: t('last7'), href: href('7d') },
          { key: '30d', label: tm('days30'), href: href('30d') },
        ]}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
          <span className="truncate text-meta font-medium text-fg-2">
            {t('ordersIn', { system: src })}
          </span>
          <strong className="text-m-kpi tabular">{formatNumber(sum('sourceCount'), locale)}</strong>
        </MobileCard>
        <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
          <span className="truncate text-meta font-medium text-fg-2">
            {t('invoicesIn', { system: dest })}
          </span>
          <strong className="text-m-kpi tabular">{formatNumber(sum('destCount'), locale)}</strong>
          {diff > 0 && (
            <span className="truncate text-micro font-medium text-fg-2">
              {tm('diffAmount', { amount: money(sum('sourceAmount') - sum('destAmount')) })}
            </span>
          )}
        </MobileCard>
      </div>

      {days.length === 0 && <MobileEmpty icon={Scale} title={tm('noDays')} />}
      {days.map((d) => {
        const off = d.sourceCount - d.destCount;
        const date = formatDate(new Date(`${d.day}T12:00:00Z`), locale);
        return (
          <ExpandCard
            key={d.day}
            open={d === firstOff}
            title={d.day === today ? `${date} · ${t('today')}` : date}
            meta={tm('dayMeta', { orders: d.sourceCount, invoices: d.destCount })}
            trailing={
              off > 0 ? (
                <StatusPill status="warn" compact>
                  {t('ordersCount', { count: off })}
                </StatusPill>
              ) : (
                <StatusPill status="ok" compact>
                  {tm('noDiff')}
                </StatusPill>
              )
            }
          >
            <KV k={t('ordersIn', { system: src })}>{formatNumber(d.sourceCount, locale)}</KV>
            <KV k={t('invoicesIn', { system: dest })}>{formatNumber(d.destCount, locale)}</KV>
            <KV k={t('col.sourceAmount')}>{money(d.sourceAmount)}</KV>
            <KV k={t('col.destAmount', { system: dest })}>{money(d.destAmount)}</KV>
            {off > 0 && (
              <CardActions>
                <CardButton
                  href={`/activity?flow=${flow.id}&outcome=failed&period=7d`}
                  linkAs={Link}
                >
                  {t('seeOrders', { count: off })}
                </CardButton>
                {canEdit && <RetryFailedButton flowId={flow.id} label={tm('retry')} />}
              </CardActions>
            )}
          </ExpandCard>
        );
      })}
      {missingToday.length > 0 && (
        <MobileFootnote>
          {t('explanation', {
            date: formatDate(new Date(), locale),
            list: missingToday.join(', '),
            count: missingToday.length,
          })}
        </MobileFootnote>
      )}
    </MobileShell>
  );
}
