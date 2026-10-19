import type { Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PlatformHeader } from '@/components/platform/platform-header';
import { requireStaff } from '@/server/platform';
import { gearCounts } from '@/server/platform-data';

export async function generateMetadata() {
  const t = await getTranslations('platform');
  return { title: { default: t('badge'), template: `%s · Agentor ${t('badge')}` } };
}

/** Agentor Platform (README decision 16): staff only, own header, no customer app shell. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const { session, actor } = await requireStaff();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations('nav');
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card"
      >
        {t('skipToContent')}
      </a>
      <PlatformHeader
        user={{ name: actor.name, email: session.user.email, role: actor.role }}
        counts={await gearCounts(actor.userId, locale)}
      />
      {children}
    </div>
  );
}
