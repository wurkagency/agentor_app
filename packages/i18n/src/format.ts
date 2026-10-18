/**
 * Formatting in the user's locale (designspecifikation §9.3, produktspecifikation §12).
 * da-DK: 1.234,50 kr. · 18. okt. 2026 · 14:02 · "for 4 min. siden".
 */
export type Locale = 'da' | 'en';

const BCP47: Record<Locale, string> = { da: 'da-DK', en: 'en-GB' };

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
function memo<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  key: string,
  make: () => T,
): T {
  let f = cache.get(key) as T | undefined;
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}

/** 1234.5 → "1.234,50 kr." */
export function formatMoney(amount: number, locale: Locale = 'da', currency = 'DKK'): string {
  return memo(
    `money:${locale}:${currency}`,
    () =>
      new Intl.NumberFormat(BCP47[locale], {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      }),
  ).format(amount);
}

/** 184320 → "184.320" (whole numbers in stats and tables). */
export function formatNumber(value: number, locale: Locale = 'da', fractionDigits = 0): string {
  return memo(
    `num:${locale}:${fractionDigits}`,
    () =>
      new Intl.NumberFormat(BCP47[locale], {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }),
  ).format(value);
}

/** 0.004 → "0,4 %" */
export function formatPercent(ratio: number, locale: Locale = 'da', fractionDigits = 1): string {
  return memo(
    `pct:${locale}:${fractionDigits}`,
    () =>
      new Intl.NumberFormat(BCP47[locale], {
        style: 'percent',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }),
  ).format(ratio);
}

/** → "18. okt. 2026" */
export function formatDate(
  date: Date,
  locale: Locale = 'da',
  timeZone = 'Europe/Copenhagen',
): string {
  return memo(
    `date:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(BCP47[locale], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone,
      }),
  ).format(date);
}

/** → "14:02". Built from parts because ICU's Danish default is "14.02" (§9.3 wants a colon). */
export function formatTime(
  date: Date,
  locale: Locale = 'da',
  timeZone = 'Europe/Copenhagen',
): string {
  const parts = memo(
    `time:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(BCP47[locale], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      }),
  ).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

/** → "18. okt. 2026 kl. 14:02" (exact time for tooltips). */
export function formatDateTime(
  date: Date,
  locale: Locale = 'da',
  timeZone = 'Europe/Copenhagen',
): string {
  const joiner = locale === 'da' ? ' kl. ' : ', ';
  return `${formatDate(date, locale, timeZone)}${joiner}${formatTime(date, locale, timeZone)}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

// Danish short units as used in the design ("for 4 min. siden"). ICU's short style drops "for".
const DA_UNIT: Record<string, (n: number) => string> = {
  year: () => 'år',
  month: () => 'md.',
  week: (n) => (n === 1 ? 'uge' : 'uger'),
  day: (n) => (n === 1 ? 'dag' : 'dage'),
  hour: () => 't.',
  minute: () => 'min.',
  second: () => 'sek.',
};

/**
 * Relative time: "for 4 min. siden", "om 2 t.". Under 45 seconds reads "lige nu".
 */
export function formatRelative(date: Date, now: Date = new Date(), locale: Locale = 'da'): string {
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return locale === 'da' ? 'lige nu' : 'just now';
  const [unit, seconds] = UNITS.find(([, s]) => abs >= s) ?? ['second', 1];
  const value = Math.round(abs / seconds);
  if (locale === 'da') {
    const label = `${formatNumber(value, 'da')} ${DA_UNIT[unit]!(value)}`;
    return diffSec < 0 ? `for ${label} siden` : `om ${label}`;
  }
  const rtf = memo(
    `rel:${locale}`,
    () => new Intl.RelativeTimeFormat(BCP47[locale], { style: 'short', numeric: 'always' }),
  );
  return rtf.format(diffSec < 0 ? -value : value, unit);
}

/** "#10432" for order numbers (§9.3). */
export function formatOrderNumber(n: string | number): string {
  const s = String(n);
  return s.startsWith('#') ? s : `#${s}`;
}
