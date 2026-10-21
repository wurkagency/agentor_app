'use client';

import { formatMinutes, type Locale } from '@agentor/i18n';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';

/** "23 t" from three hours up, otherwise "1 t 50 min."; never below zero. */
export function remainingText(expiresAt: Date, now: Date, locale: Locale): string {
  const minutes = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60_000));
  return minutes >= 180
    ? `${Math.floor(minutes / 60)} ${locale === 'da' ? 't' : 'h'}`
    : formatMinutes(minutes, locale);
}

/**
 * Time left on a support grant (S9), updated every minute. Not a live region: a countdown that
 * talks every minute would drown the rest of the page.
 */
export function Countdown({ expiresAt, template }: { expiresAt: string; template: string }) {
  const locale = useLocale() as Locale;
  const at = new Date(expiresAt);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span suppressHydrationWarning>
      {template.replace('{time}', remainingText(at, now, locale))}
    </span>
  );
}
