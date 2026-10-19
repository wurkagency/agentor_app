'use client';

import { formatMinutes, formatTime, formatDate, type Locale } from '@agentor/i18n';
import { Avatar, Icon, Segmented, cn } from '@agentor/ui';
import { ArrowRight, Clock, KeyRound, Lock, UserRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

export interface TimelineEvent {
  id: string;
  kind: 'customer_message' | 'reply' | 'internal_note' | 'status' | 'system' | 'access' | 'session';
  authorName: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

type Filter = 'all' | 'customer' | 'notes' | 'time';

/**
 * Aktivitet (S3): customer messages, our replies, yellow internal notes, access requests and
 * automatically logged sessions, oldest first.
 */
export function CaseTimeline({ events }: { events: TimelineEvent[] }) {
  const t = useTranslations('platform.case');
  const locale = useLocale() as Locale;
  const [filter, setFilter] = useState<Filter>('all');
  const shown = events.filter((e) =>
    filter === 'customer'
      ? e.kind === 'customer_message' || e.kind === 'reply'
      : filter === 'notes'
        ? e.kind === 'internal_note'
        : filter === 'time'
          ? e.kind === 'session'
          : true,
  );
  const when = (iso: string) => {
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    return today ? t('todayAt', { time: formatTime(d, locale) }) : `${formatDate(d, locale)} ${formatTime(d, locale)}`;
  };
  return (
    <section aria-labelledby="case-activity" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="case-activity" className="m-0 text-card">
          {t('activity')}
        </h2>
        <Segmented
          aria-label={t('activityFilter')}
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'all', label: t('filter.all') },
            { value: 'customer', label: t('filter.customer') },
            { value: 'notes', label: t('filter.notes') },
            { value: 'time', label: t('filter.time') },
          ]}
        />
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {shown.map((e) => {
          const customer = e.kind === 'customer_message';
          const note = e.kind === 'internal_note';
          const boxed = customer || note || e.kind === 'reply' || e.kind === 'session';
          return (
            <li key={e.id} className="flex gap-3">
              <span className="mt-1 flex-none">
                {customer ? (
                  <span className="grid size-7 place-items-center rounded-full bg-bg-base text-fg-2">
                    <Icon icon={UserRound} size={14} />
                  </span>
                ) : e.kind === 'system' || e.kind === 'status' ? (
                  <span className="grid size-7 place-items-center text-fg-2">
                    <Icon icon={ArrowRight} size={14} />
                  </span>
                ) : (
                  <Avatar name={e.authorName} size={28} tone="navy" />
                )}
              </span>
              <div
                className={cn(
                  'flex min-w-0 flex-1 flex-col gap-1',
                  boxed && 'rounded-md px-4 py-3',
                  customer && 'bg-surface shadow-ring-chip',
                  e.kind === 'reply' && 'bg-surface shadow-ring-chip',
                  note && 'bg-note-bg',
                  e.kind === 'session' && 'bg-bg-base',
                )}
              >
                <p className="m-0 flex flex-wrap items-center gap-2 text-table">
                  <strong>{e.kind === 'system' ? t('system') : e.authorName}</strong>
                  {customer && <Tag>{t('tag.customer')}</Tag>}
                  {e.kind === 'reply' && <Tag>{t('tag.reply')}</Tag>}
                  {note && (
                    <Tag>
                      <Icon icon={Lock} size={14} />
                      {t('tag.note')}
                    </Tag>
                  )}
                  {e.kind === 'session' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2 py-0.5 text-micro font-semibold text-on-navy">
                      <Icon icon={Clock} size={14} />
                      {t('tag.auto', { time: formatMinutes(Number(e.meta.minutes ?? 0), locale) })}
                    </span>
                  )}
                  {e.kind === 'access' && (
                    <span className="inline-flex items-center gap-1 text-meta text-fg-2">
                      <Icon icon={KeyRound} size={14} />
                    </span>
                  )}
                  <span className="text-meta text-fg-2">{when(e.createdAt)}</span>
                </p>
                {e.kind === 'access' ? (
                  <p className="m-0 text-table">
                    {t('accessRequested', {
                      hours: Number(e.meta.hours ?? 0),
                      scope: t(`scope.${String(e.meta.scope ?? 'view')}`),
                      reason: e.body,
                    })}
                  </p>
                ) : e.kind === 'session' ? (
                  <>
                    <p className="m-0 text-table font-semibold">
                      {t('sessionTitle', { time: formatMinutes(Number(e.meta.minutes ?? 0), locale) })}
                    </p>
                    <p className="m-0 text-meta text-fg-2">
                      {[t('sessionActions', { count: Number(e.meta.actions ?? 0) }), e.body].filter(Boolean).join(' · ')}
                    </p>
                  </>
                ) : e.kind === 'status' ? (
                  <p className="m-0 text-table">{t('statusChanged', { status: e.body })}</p>
                ) : (
                  <p className="m-0 whitespace-pre-wrap text-table">{e.body}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-base px-2 py-0.5 text-micro font-semibold text-fg-1 shadow-ring-chip">
      {children}
    </span>
  );
}
