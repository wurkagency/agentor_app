import { formatMinutes, type Locale } from '@agentor/i18n';

/** Time left on a support grant: "23 t" from three hours up, otherwise "1 t 50 min."; never below zero. */
export function remainingText(expiresAt: Date, now: Date, locale: Locale): string {
  const minutes = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60_000));
  return minutes >= 180
    ? `${Math.floor(minutes / 60)} ${locale === 'da' ? 't' : 'h'}`
    : formatMinutes(minutes, locale);
}
