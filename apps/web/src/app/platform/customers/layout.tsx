import { myGrants } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

export default async function CustomersLayout({ children }: { children: ReactNode }) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.customers');
  const mine = (await myGrants(db(), actor.userId)).filter(
    (g) => g.state === 'active' || g.state === 'pending',
  ).length;
  return (
    <>
      <SecondaryBar
        label={t('nav')}
        items={[
          { href: '/platform/customers', label: t('all'), exact: true },
          { href: '/platform/customers/mine', label: t('mine'), count: mine },
          { href: '/platform/customers/recent', label: t('recent') },
        ]}
      />
      {children}
    </>
  );
}
