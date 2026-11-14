import type { Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Clock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { dayMonth, monthYear } from '@/components/platform/finance/bits';
import { OnPath } from '@/components/shell/on-path';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { currentMonth } from '@/server/finance-data';
import { requireStaff } from '@/server/platform';

/**
 * Administration (README decision 24): System Status · Brugere · Produkt · Rapporter. Superadmin
 * only; a Supporter gets 404 here and on every page, export and action below it.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireStaff(true);
  const t = await getTranslations('platform');
  const locale = (await getLocale()) as Locale;
  const m = currentMonth();
  const last = new Date(m.end.getTime() - 1);
  return (
    <>
      <SecondaryBar
        label={t('subnav.label', { section: t('section.admin') })}
        items={[
          { href: '/platform/admin/status', label: t('subnav.admin.status') },
          { href: '/platform/admin/users', label: t('subnav.admin.users') },
          { href: '/platform/admin/product', label: t('subnav.admin.product') },
          { href: '/platform/admin/reports', label: t('subnav.admin.reports') },
        ]}
        right={
          <OnPath prefix="/platform/admin/reports">
            <span className="flex items-center gap-2 text-meta font-medium text-fg-2">
              <Icon icon={Clock} size={14} />
              {t('finance.openPeriod', { month: monthYear(m.start, locale) })}{' '}
              <strong className="text-fg-1">{dayMonth(last, locale)}</strong>
            </span>
          </OnPath>
        }
      />
      {children}
    </>
  );
}
