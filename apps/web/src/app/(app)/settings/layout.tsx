import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SecondaryBar, type SecondaryItem } from '@/components/shell/secondary-nav';
import { TransactionMeter } from '@/components/shell/transaction-meter';
import { requireAppContext } from '@/server/auth/session';

/**
 * Settings (App-skal-B-Indstillinger, README decision 3): reached from the profile menu; the
 * pages are secondary pills. Owners and admins see everything; other roles see their own
 * notifications and profile (produktspecifikation §6).
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAppContext();
  const t = await getTranslations('nav');
  const admin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const items: SecondaryItem[] = [
    ...(admin
      ? [
          { href: '/settings/company', label: t('company') },
          { href: '/settings/team', label: t('team') },
        ]
      : []),
    { href: '/settings/notifications', label: t('notificationSettings') },
    { href: '/settings/security', label: t('security') },
    ...(admin ? [{ href: '/settings/audit-log', label: t('auditLog') }] : []),
    { href: '/settings/profile', label: t('myProfile') },
  ];
  return (
    <>
      <SecondaryBar label={t('secondary')} items={items} right={<TransactionMeter />} />
      {children}
    </>
  );
}
