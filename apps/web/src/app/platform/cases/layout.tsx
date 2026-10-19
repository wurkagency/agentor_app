import { listCases } from '@agentor/db';
import { formatMinutes, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Clock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { statsFor, tenantNames } from '@/server/platform-data';

export default async function CasesLayout({ children }: { children: ReactNode }) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.cases');
  const locale = (await getLocale()) as Locale;
  const [stats, names] = await Promise.all([statsFor(actor.userId), tenantNames(actor.userId)]);
  const archived = (await listCases(db(), actor.userId, names, { archived: true })).length;
  return (
    <>
      <SecondaryBar
        label={t('nav')}
        items={[
          { href: '/platform/cases', label: t('board'), exact: true },
          { href: '/platform/cases/list', label: t('list') },
          { href: '/platform/cases/archive', label: t('archive'), count: archived },
        ]}
        right={
          <span className="flex items-center gap-1.5 text-meta text-fg-2">
            <Icon icon={Clock} size={14} />
            {t('myTimeToday')}
            <strong className="text-fg-1">{formatMinutes(stats.minutesToday, locale)}</strong>
          </span>
        }
      />
      {children}
    </>
  );
}
