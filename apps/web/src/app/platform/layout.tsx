import type { Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  MobileChromeProvider,
  PlatformTabBar,
  PlatformTopBar,
  UnderTabBar,
} from '@/components/mobile/chrome';
import { PlatformHeader } from '@/components/platform/platform-header';
import { requireStaff } from '@/server/platform';
import { gearCounts, initials } from '@/server/platform-data';

export async function generateMetadata() {
  const t = await getTranslations('platform');
  return { title: { default: t('badge'), template: `%s · Agentor ${t('badge')}` } };
}

/**
 * Agentor Platform (README decision 16): staff only, own header, no customer app shell. Below
 * 768 px the navy mobile bars (README decision 20); Finans only for Superadmin (decision 18).
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const { session, actor } = await requireStaff();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations('nav');
  const counts = await gearCounts(actor.userId, locale);
  const skip =
    'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card';
  return (
    <div className="group/shell flex min-h-dvh flex-col">
      <a href="#main" className={`${skip} max-md:hidden`}>
        {t('skipToContent')}
      </a>
      <a href="#main-mobile" className={`${skip} md:hidden`}>
        {t('skipToContent')}
      </a>
      <div className="contents max-md:hidden">
        <PlatformHeader
          user={{ name: actor.name, email: session.user.email, role: actor.role }}
          counts={counts}
        />
      </div>
      <MobileChromeProvider
        value={{
          attention: { count: counts.mineCases, severe: false },
          user: { name: actor.name, initials: initials(actor.name) },
          superadmin: actor.role === 'superadmin',
        }}
      >
        <PlatformTopBar fallback />
        <UnderTabBar platform>{children}</UnderTabBar>
        <PlatformTabBar />
      </MobileChromeProvider>
    </div>
  );
}
