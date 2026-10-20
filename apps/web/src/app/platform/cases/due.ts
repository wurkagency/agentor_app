import { formatDate, formatTime, type Locale } from '@agentor/i18n';

/**
 * The reply deadline on mobile (MP02, MP03): "Svarfrist overskredet" in red, "Svar inden 16:00"
 * in orange today, plain otherwise. Nothing for cases waiting on the customer.
 */
export function mobileDue(
  t: (key: 'overdue' | 'dueToday' | 'dueTomorrow' | 'dueOn', p?: Record<string, string>) => string,
  c: { status: string; dueAt: string | null },
  now: Date,
  locale: Locale,
): { text: string; tone: 'text-error-fg' | 'text-warn-fg' | 'text-fg-2' } | null {
  if (!c.dueAt || c.status === 'waiting' || c.status === 'resolved' || c.status === 'closed')
    return null;
  const at = new Date(c.dueAt);
  if (at < now) return { text: t('overdue'), tone: 'text-error-fg' };
  const day = formatDate(at, locale);
  if (day === formatDate(now, locale))
    return { text: t('dueToday', { time: formatTime(at, locale) }), tone: 'text-warn-fg' };
  if (day === formatDate(new Date(now.getTime() + 86_400_000), locale))
    return { text: t('dueTomorrow'), tone: 'text-fg-2' };
  return { text: t('dueOn', { date: day }), tone: 'text-fg-2' };
}
