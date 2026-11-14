import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

/**
 * Focus flows (login, MFA, onboarding): a centred card on the canvas without the app shell
 * (README decision 13, D14).
 */
export default async function FocusLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <div className="relative flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-gutter py-10">
        <Logo size="focus" />
        {children}
      </main>
      <footer className="flex flex-wrap justify-center gap-6 pb-6 text-meta font-medium text-fg-2">
        <span>{t('footerLanguage')}</span>
        <a className="text-fg-2" href="https://agentor.dk/privatliv">
          {t('privacy')}
        </a>
        <a className="text-fg-2" href="https://agentor.dk/hjaelp">
          {t('help')}
        </a>
        <span>{t('copyright', { year: new Date().getFullYear() })}</span>
      </footer>
    </div>
  );
}
