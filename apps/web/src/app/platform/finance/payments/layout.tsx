import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DesktopOnly } from '@/components/mobile/desktop-only';

export default async function Layout({ children }: { children: ReactNode }) {
  const t = await getTranslations('platform.finance');
  return (
    <DesktopOnly area="finance" title={t('tab.payments')} platform>
      {children}
    </DesktopOnly>
  );
}
