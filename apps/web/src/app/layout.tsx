import { Toaster, TooltipProvider } from '@agentor/ui';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NowProvider } from '@/components/now';
import { jakarta, jetbrains } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Agentor', template: '%s · Agentor' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('nav');
  return (
    <html lang={locale} className={`${jakarta.variable} ${jetbrains.variable}`}>
      <body>
        <NextIntlClientProvider>
          <NowProvider initial={Date.now()}>
            <TooltipProvider>
              {children}
              <Toaster label={t('notifications')} />
            </TooltipProvider>
          </NowProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
