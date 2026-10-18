import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';

export default async function SectionLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('nav');
  return (
    <>
      <SecondaryBar
        label={t('secondary')}
        items={[
          { href: '/integrations', label: t('flows'), exact: true },
          { href: '/integrations/runs', label: t('runs') },
          { href: '/integrations/templates', label: t('templates') },
        ]}
      />
      {children}
    </>
  );
}
