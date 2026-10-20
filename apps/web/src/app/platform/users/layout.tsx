import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DesktopOnly } from '@/components/mobile/desktop-only';
import { SecondaryBar } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';

/** Platformbrugere (P6): Superadmin only. */
export default async function UsersLayout({ children }: { children: ReactNode }) {
  await requireStaff(true);
  const t = await getTranslations('platform.users');
  return (
    <DesktopOnly area="platformAdmin" title={t('title')} platform>
      <SecondaryBar
        label={t('nav')}
        items={[
          { href: '/platform/users', label: t('staff'), exact: true },
          { href: '/platform/users/roles', label: t('rolesTab') },
          { href: '/platform/users/audit', label: t('audit') },
        ]}
      />
      {children}
    </DesktopOnly>
  );
}
