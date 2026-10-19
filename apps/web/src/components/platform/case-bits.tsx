'use client';

import { formatDate, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { Avatar, Icon, cn } from '@agentor/ui';
import { Clock, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type Priority = 'critical' | 'high' | 'normal' | 'low';
export type CaseStatusKey = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed';

/** Priority without status colours (README decision 17): dark, outlined, plain. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const t = useTranslations('platform.case');
  return (
    <span
      className={cn(
        'inline-flex h-badge items-center rounded-full px-2 text-micro font-semibold',
        priority === 'critical' && 'bg-fg-1 text-white',
        priority === 'high' && 'text-fg-1 shadow-ring-dark',
        (priority === 'normal' || priority === 'low') && 'text-fg-2',
      )}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

export function AssigneeAvatar({ name }: { name: string | null }) {
  const t = useTranslations('platform.case');
  return name ? (
    <span title={name}>
      <Avatar name={name} size={28} tone="navy" />
    </span>
  ) : (
    <span
      title={t('unassigned')}
      className="grid size-7 place-items-center rounded-full border border-dashed border-border-strong text-fg-2"
    >
      <Icon icon={UserRound} size={14} />
      <span className="sr-only">{t('unassigned')}</span>
    </span>
  );
}

/** "Løs inden 17:00", "Overskredet 25 min.", "Venter i 2 dage", "Løst i dag 10:40" (S1). */
export function dueText(
  t: (k: string, p?: Record<string, string | number>) => string,
  c: { status: CaseStatusKey; dueAt: string | null; updatedAt: string; resolvedAt: string | null },
  now: Date,
  locale: Locale,
): { text: string; overdue: boolean } {
  if (c.status === 'resolved' || c.status === 'closed') {
    const at = new Date(c.resolvedAt ?? c.updatedAt);
    return { text: t('resolvedAt', { when: dayTime(at, now, locale, t) }), overdue: false };
  }
  if (c.status === 'waiting') {
    const days = Math.floor((now.getTime() - new Date(c.updatedAt).getTime()) / 86_400_000);
    return { text: days < 1 ? t('waitingToday') : t('waitingDays', { count: days }), overdue: false };
  }
  if (!c.dueAt) return { text: t('noDue'), overdue: false };
  const due = new Date(c.dueAt);
  if (due < now) {
    const min = Math.round((now.getTime() - due.getTime()) / 60_000);
    return {
      text: t('overdue', { time: min < 60 ? `${min} min.` : formatRelative(due, now, locale) }),
      overdue: true,
    };
  }
  return {
    text: t(c.status === 'new' ? 'answerBy' : 'solveBy', { when: dayTime(due, now, locale, t) }),
    overdue: false,
  };
}

function dayTime(
  d: Date,
  now: Date,
  locale: Locale,
  t: (k: string, p?: Record<string, string | number>) => string,
) {
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString();
  const time = formatTime(d, locale);
  if (sameDay) return t('todayAt', { time });
  if (tomorrow) return t('tomorrowAt', { time });
  return formatDate(d, locale).replace(/ \d{4}$/, '');
}

export function DueLabel({ text, overdue }: { text: string; overdue: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-meta', overdue ? 'font-semibold text-error-fg' : 'text-fg-2')}>
      <Icon icon={Clock} size={14} />
      {text}
    </span>
  );
}
