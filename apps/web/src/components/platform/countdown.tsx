'use client';

import type { Locale } from '@agentor/i18n';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { remainingText } from '@/lib/remaining';

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
