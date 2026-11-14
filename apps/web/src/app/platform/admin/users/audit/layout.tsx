import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DesktopOnly } from '@/components/mobile/desktop-only';

/** No mobile board: MP12 shows the rights per role on Platformbrugere itself. */
export default async function Layout({ children }: { children: ReactNode }) {
  const t = await getTranslations('platform.users');
  return (
    <DesktopOnly area="platformAdmin" title={t('title')} platform>
      {children}
    </DesktopOnly>
  );
}
