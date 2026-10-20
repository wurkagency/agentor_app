import { formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import { cn } from '@agentor/ui';
import { ChatBubble, InternalNote, TimelineEvent } from '@agentor/ui/mobile';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PriorityBadge, type CaseStatusKey, type Priority } from '@/components/platform/case-bits';
import { mobileDue } from '../due';
import { CaseMobileShell } from './mobile-case';

export interface MobileCaseEvent {
  id: string;
  kind: string;
  authorName: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const DOT: Record<CaseStatusKey, string> = {
  new: 'bg-fg-1',
  in_progress: 'bg-ok-fg',
  waiting: 'bg-warn-fg',
  resolved: 'bg-ok-fg',
  closed: 'bg-fg-2',
};

/** MP03 Sag: status, priority and deadline, then the conversation as chat bubbles. */
export async function CaseMobile({
  c,
  events,
  plan,
  timer,
}: {
  c: {
    id: string;
    number: number;
    title: string;
    tenantName: string;
    status: CaseStatusKey;
    priority: Priority;
    dueAt: Date | null;
    createdByName: string;
    createdVia: string;
  };
  events: MobileCaseEvent[];
  plan: string | null;
  timer: { caseId: string | null; startedAt: string } | null;
}) {
  const t = await getTranslations('mobile.platform.case');
  const tc = await getTranslations('platform.case');
  const td = await getTranslations('mobile.platform.cases');
  const locale = (await getLocale()) as Locale;
  const contact = c.createdVia === 'customer' ? c.createdByName : null;
  const due = mobileDue(
    td,
    { status: c.status, dueAt: c.dueAt?.toISOString() ?? null },
    new Date(),
    locale,
  );
  const first = (name: string) => name.split(' ')[0] ?? name;

  return (
    <CaseMobileShell
      caseId={c.id}
      title={`#${c.number} · ${c.title}`}
      subtitle={[c.tenantName, contact].filter(Boolean).join(' · ')}
      caseLabel={`#${c.number} · ${c.tenantName}`}
      plan={plan}
      timer={timer}
      contactName={contact ? first(contact) : c.tenantName}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface px-2.5 text-micro font-semibold text-fg-1 shadow-ring-chip">
          <span aria-hidden className={cn('size-2 rounded-full', DOT[c.status])} />
          {tc(`status.${c.status}`)}
        </span>
        <PriorityBadge priority={c.priority} />
        <span className="flex-1" />
        {/* Orange text on the canvas is under 4.5:1: the words stay dark unless overdue. */}
        {due && (
          <span
            className={cn(
              'text-meta font-medium',
              due.tone === 'text-error-fg' ? due.tone : 'text-fg-1',
            )}
          >
            {due.text}
          </span>
        )}
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label={tc('activity')}>
        {events.map((e) => {
          const time = formatTime(e.createdAt, locale);
          return (
            <li key={e.id} className="flex flex-col">
              {e.kind === 'customer_message' || e.kind === 'reply' ? (
                <ChatBubble
                  from={e.kind === 'reply' ? 'agentor' : 'customer'}
                  author={e.authorName}
                  time={time}
                >
                  {e.body}
                </ChatBubble>
              ) : e.kind === 'internal_note' ? (
                <InternalNote label={t('noteLabel', { name: first(e.authorName), time })}>
                  {e.body}
                </InternalNote>
              ) : e.kind === 'session' ? (
                <TimelineEvent>
                  {t('sessionSaved', {
                    minutes: formatMinutes(Number(e.meta.minutes ?? 0), locale),
                    time,
                  })}
                </TimelineEvent>
              ) : e.kind === 'status' ? (
                <TimelineEvent>
                  {tc('statusChanged', { status: e.body })} · {time}
                </TimelineEvent>
              ) : e.kind === 'access' ? (
                <TimelineEvent>
                  {tc('accessRequested', {
                    hours: Number(e.meta.hours ?? 0),
                    scope: tc(`scope.${String(e.meta.scope ?? 'view')}`),
                    reason: e.body,
                  })}{' '}
                  · {time}
                </TimelineEvent>
              ) : (
                <TimelineEvent>
                  {e.body} · {time}
                </TimelineEvent>
              )}
            </li>
          );
        })}
      </ol>
      {/* MP16 Løs sag: no place on the MP03 board, so a quiet link under the conversation. */}
      {c.status !== 'resolved' && c.status !== 'closed' && (
        <Link
          href={`/platform/cases/${c.id}/resolve`}
          className="touch-target self-center text-meta font-semibold text-fg-1 underline"
        >
          {t('resolve')}
        </Link>
      )}
    </CaseMobileShell>
  );
}
