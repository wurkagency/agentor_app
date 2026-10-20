import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DesktopOnly } from '@/components/mobile/desktop-only';

/** No mobile board for the team's time or time per customer; MP15 is the person's own time. */
export default async function Layout({ children }: { children: ReactNode }) {
  const t = await getTranslations('platform.time');
  return (
    <DesktopOnly area="platformAdmin" title={t('title')} platform>
      {children}
    </DesktopOnly>
  );
}
