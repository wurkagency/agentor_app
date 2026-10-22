import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { TransactionMeter } from '@/components/shell/transaction-meter';
import { requireRole } from '@/server/auth/session';

export default async function SectionLayout({ children }: { children: ReactNode }) {
  await requireRole(['owner']);
  const t = await getTranslations('nav');
  return (
    <>
      <SecondaryBar
        label={t('secondary')}
        right={<TransactionMeter />}
        items={[
          { href: '/billing', label: t('plan'), exact: true },
          { href: '/billing/invoices', label: t('invoices') },
          { href: '/billing/payment', label: t('payment') },
        ]}
      />
      {children}
    </>
  );
}
