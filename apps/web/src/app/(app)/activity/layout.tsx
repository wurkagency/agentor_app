import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { TransactionMeter } from '@/components/shell/transaction-meter';

export default async function SectionLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('nav');
  return (
    <>
      <SecondaryBar
        label={t('secondary')}
        right={<TransactionMeter />}
        items={[
          { href: '/activity', label: t('log'), exact: true },
          { href: '/activity/reconciliation', label: t('reconciliation') },
        ]}
      />
      {children}
    </>
  );
}
