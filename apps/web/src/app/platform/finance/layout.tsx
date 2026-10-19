import type { Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Clock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { dayMonth, monthYear } from '@/components/platform/finance/bits';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { currentMonth } from '@/server/finance-data';
import { requireStaff } from '@/server/platform';

/** Finans (README decision 18, F1–F7): Superadmin only. */
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requireStaff(true);
  const t = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const m = currentMonth();
  const last = new Date(m.end.getTime() - 1);
  return (
    <>
      <SecondaryBar
        label={t('nav')}
        items={[
          { href: '/platform/finance', label: t('tab.overview'), exact: true },
          { href: '/platform/finance/subscriptions', label: t('tab.subscriptions') },
          { href: '/platform/finance/support', label: t('tab.support') },
          { href: '/platform/finance/payments', label: t('tab.payments') },
          { href: '/platform/finance/reports', label: t('tab.reports') },
        ]}
        right={
          <span className="hidden items-center gap-2 text-meta font-medium text-fg-2 md:flex">
            <Icon icon={Clock} size={14} />
            {t('openPeriod', { month: monthYear(m.start, locale) })}{' '}
            <strong className="text-fg-1">{dayMonth(last, locale)}</strong>
          </span>
        }
      />
      {children}
    </>
  );
}
