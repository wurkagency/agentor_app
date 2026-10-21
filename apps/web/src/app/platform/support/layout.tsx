import { formatMinutes, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Clock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { statsFor } from '@/server/platform-data';

/** Support (README decision 24): Sager · Adgange · Fejl · Tidsforbrug, for every staff member. */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform');
  const locale = (await getLocale()) as Locale;
  const stats = await statsFor(actor.userId);
  return (
    <>
      <SecondaryBar
        label={t('subnav.label', { section: t('section.support') })}
        items={[
          { href: '/platform/support/cases', label: t('subnav.support.cases') },
          { href: '/platform/support/access', label: t('subnav.support.access') },
          { href: '/platform/support/errors', label: t('subnav.support.errors') },
          { href: '/platform/support/time', label: t('subnav.support.time') },
        ]}
        right={
          <span className="flex items-center gap-1.5 text-meta text-fg-2">
            <Icon icon={Clock} size={14} />
            {t('cases.myTimeToday')}
            <strong className="text-fg-1">{formatMinutes(stats.minutesToday, locale)}</strong>
          </span>
        }
      />
      {children}
    </>
  );
}
