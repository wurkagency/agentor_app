import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DesktopOnly } from '@/components/mobile/desktop-only';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';

export default async function TimeLayout({ children }: { children: ReactNode }) {
  await requireStaff();
  const t = await getTranslations('platform.time');
  return (
    <DesktopOnly area="platformAdmin" title={t('title')} platform>
      <SecondaryBar
        label={t('nav')}
        items={[
          { href: '/platform/time', label: t('title'), exact: true },
          { href: '/platform/time/team', label: t('team') },
          { href: '/platform/time/customers', label: t('perCustomer') },
        ]}
      />
      {children}
    </DesktopOnly>
  );
}
