import type { Growth } from '@agentor/ui';
import {
  KpiStrip,
  MobileCard,
  MobileEmpty,
  MobilePageTitle,
  MobileShell,
  RowIcon,
  RowLink,
  SectionHeading,
} from '@agentor/ui/mobile';
import { CircleCheck, Clock, CreditCard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';

export interface FinanceMobileData {
  month: string;
  monthName: string;
  mrr: string;
  mrrGrowth: Growth | undefined;
  subscriptions: number;
  newSubs: number;
  paymentProblems: number;
  supportNet: string;
  supportTime: string;
  supportGross: string;
  overdue: string;
  overdueCount: number;
  ytd: string;
  ytdGrowth: Growth | undefined;
  lastMonthName: string;
  lastMonthTotal: string;
  actions: { key: string; name: string; detail: string; tone: 'error' | 'warn'; card: boolean }[];
}

const OVERDUE = '/platform/finance/invoices?status=overdue';

/**
 * MP06 Finans (Superadmin): the key figures as cards (as on desktop F1, at the user's request),
 * and what needs action; the areas are the sub-tabs above.
 */
export async function FinanceMobile({ d }: { d: FinanceMobileData }) {
  const t = await getTranslations('mobile.platform.finance');
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <PlatformSubTabs />
      <MobilePageTitle title={t('title')} aside={d.month} />
      <KpiStrip
        label={t('kpiLabel')}
        items={[
          { label: t('mrrShort'), value: d.mrr, trend: d.mrrGrowth },
          {
            label: t('subscriptions'),
            value: d.subscriptions,
            trend: d.newSubs
              ? { direction: 'up', tone: 'good', text: t('newSubs', { count: d.newSubs }) }
              : undefined,
          },
          {
            label: t('support', { month: d.monthName }),
            value: d.supportNet,
            meta: d.supportTime,
          },
          {
            label: t('overdue'),
            value: d.overdue,
            trend: d.overdueCount
              ? {
                  direction: 'down',
                  tone: 'bad',
                  text: t('overdueCount', { count: d.overdueCount }),
                }
              : undefined,
          },
          { label: t('ytd'), value: d.ytd, trend: d.ytdGrowth },
        ]}
      />

      <SectionHeading>{t('needsAction')}</SectionHeading>
      {d.actions.length === 0 ? (
        <MobileEmpty icon={CircleCheck} title={t('none')} />
      ) : (
        <MobileCard>
          {d.actions.map((a) => (
            <RowLink
              key={a.key}
              href={OVERDUE}
              linkAs={Link}
              leading={<RowIcon icon={a.card ? CreditCard : Clock} tone={a.tone} size={30} />}
              title={a.name}
              meta={a.detail}
            />
          ))}
        </MobileCard>
      )}
    </MobileShell>
  );
}
