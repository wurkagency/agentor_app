import type { Growth } from '@agentor/ui';
import {
  MobileCard,
  MobileEmpty,
  MobilePageTitle,
  MobileShell,
  RowIcon,
  RowLink,
  SectionHeading,
  StackedValue,
  TrendPill,
} from '@agentor/ui/mobile';
import {
  BarChart3,
  CircleCheck,
  Clock,
  CreditCard,
  Headphones,
  ReceiptText,
  Repeat,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';

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

/** MP06 Finans (Superadmin): key figures, what needs action, and the finance areas. */
export async function FinanceMobile({ d }: { d: FinanceMobileData }) {
  const t = await getTranslations('mobile.platform.finance');
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <MobilePageTitle title={t('title')} aside={d.month} />
      <MobileCard>
        <RowLink
          href="/platform/finance/subscriptions"
          linkAs={Link}
          title={t('mrr')}
          trailing={
            <StackedValue
              value={d.mrr}
              {...(d.mrrGrowth ? { pill: <TrendPill growth={d.mrrGrowth} /> } : {})}
            />
          }
        />
        <RowLink
          href="/platform/finance/subscriptions"
          linkAs={Link}
          title={t('subscriptions')}
          trailing={
            <StackedValue
              value={d.subscriptions}
              {...(d.newSubs
                ? {
                    pill: (
                      <TrendPill
                        growth={{
                          direction: 'up',
                          tone: 'good',
                          text: t('newSubs', { count: d.newSubs }),
                        }}
                      />
                    ),
                  }
                : {})}
            />
          }
        />
        <RowLink
          href="/platform/finance/support"
          linkAs={Link}
          title={t('support', { month: d.monthName })}
          trailing={
            <StackedValue
              value={d.supportNet}
              pill={
                <TrendPill growth={{ direction: 'flat', tone: 'neutral', text: d.supportTime }} />
              }
            />
          }
        />
        <RowLink
          href={OVERDUE}
          linkAs={Link}
          title={t('overdue')}
          trailing={
            <StackedValue
              value={d.overdue}
              {...(d.overdueCount
                ? {
                    pill: (
                      <TrendPill
                        growth={{
                          direction: 'down',
                          tone: 'bad',
                          text: t('overdueCount', { count: d.overdueCount }),
                        }}
                      />
                    ),
                  }
                : {})}
            />
          }
        />
        <RowLink
          href="/platform/finance/reports"
          linkAs={Link}
          title={t('ytd')}
          trailing={
            <StackedValue
              value={d.ytd}
              {...(d.ytdGrowth ? { pill: <TrendPill growth={d.ytdGrowth} /> } : {})}
            />
          }
        />
      </MobileCard>

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

      <SectionHeading>{t('section')}</SectionHeading>
      <MobileCard>
        <RowLink
          href="/platform/finance/subscriptions"
          linkAs={Link}
          leading={<RowIcon icon={Repeat} />}
          title={t('subscriptions')}
          meta={t('subsMeta', { count: d.subscriptions, problems: d.paymentProblems })}
        />
        <RowLink
          href="/platform/finance/support"
          linkAs={Link}
          leading={<RowIcon icon={Headphones} />}
          title={t('settlement')}
          meta={t('settlementMeta', { month: d.monthName, amount: d.supportGross })}
        />
        <RowLink
          href="/platform/finance/payments"
          linkAs={Link}
          leading={<RowIcon icon={ReceiptText} />}
          title={t('payments')}
          meta={t('paymentsMeta', { amount: d.overdue })}
        />
        <RowLink
          href="/platform/finance/reports"
          linkAs={Link}
          leading={<RowIcon icon={BarChart3} />}
          title={t('reports')}
          meta={t('reportsMeta', { month: d.lastMonthName, amount: d.lastMonthTotal })}
        />
      </MobileCard>
    </MobileShell>
  );
}
