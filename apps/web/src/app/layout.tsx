import { Toaster, TooltipProvider } from '@agentor/ui';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/mobile/pwa';
import { NowProvider } from '@/components/now';
import { jakarta, jetbrains } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Agentor', template: '%s · Agentor' },
  robots: { index: false, follow: false },
  // Installable app (PLAN-MOBILE M3): iOS reads these instead of the manifest.
  appleWebApp: { capable: true, title: 'Agentor', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/agentor.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

/** Safe areas on phones with a notch or home indicator; the mobile bars pad for them. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#D0E84A',
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
              <PwaRegister dev={process.env.NODE_ENV !== 'production'} />
            </TooltipProvider>
          </NowProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
