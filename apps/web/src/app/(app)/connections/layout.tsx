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
          { href: '/connections', label: t('allConnections'), exact: true },
          { href: '/connections/new', label: t('catalog') },
        ]}
      />
      {children}
    </>
  );
}
