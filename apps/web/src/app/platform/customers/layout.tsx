import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';

export default async function CustomersLayout({ children }: { children: ReactNode }) {
  await requireStaff();
  const t = await getTranslations('platform');
  return (
    <>
      <SecondaryBar
        label={t('subnav.label', { section: t('section.customers') })}
        items={[{ href: '/platform/customers', label: t('subnav.customers') }]}
      />
      {children}
    </>
  );
}
