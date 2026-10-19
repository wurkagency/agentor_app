'use client';

import { formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import { Avatar, Button, Card, Checkbox, Icon, Segmented, Textarea, cn } from '@agentor/ui';
import { CircleCheck, Lock, Mail, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { resolveCaseAction } from '@/app/platform/actions';
import { Logo } from '../logo';

export interface ResolveEvent {
  kind: 'customer_message' | 'reply' | 'status' | 'session';
  authorName: string;
  body: string;
  createdAt: string;
}

/**
 * Løs sag og send forløb (S8): who gets the e-mail, what it contains (internal notes never),
 * an optional closing message, and a preview of exactly what the customer receives.
 */
export function ResolveForm({
  caseId,
  number,
  title,
  tenantName,
  recipients,
  defaultRecipient,
  events,
  minutes,
  internalNotes,
}: {
  caseId: string;
  number: number;
  title: string;
  tenantName: string;
  recipients: { userId: string; name: string; email: string }[];
  defaultRecipient: string | null;
  events: ResolveEvent[];
  minutes: number;
  internalNotes: number;
}) {
  const t = useTranslations('platform.resolve');
  const locale = useLocale() as Locale;
  const [to, setTo] = useState<string[]>(
    defaultRecipient ? [defaultRecipient] : recipients[0] ? [recipients[0].userId] : [],
  );
  const [include, setInclude] = useState({ messages: true, status: true, sessions: true, time: false });
  const [closing, setClosing] = useState('');
  const [status, setStatus] = useState<'resolved' | 'closed'>('resolved');
  const [satisfaction, setSatisfaction] = useState(true);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [pending, start] = useTransition();
  const messages = events.filter((e) => e.kind === 'customer_message' || e.kind === 'reply');
  const sessions = events.filter((e) => e.kind === 'session');
  const statuses = events.filter((e) => e.kind === 'status');
  const first = recipients.find((r) => r.userId === to[0]);
  const submit = (send: boolean) =>
    start(async () => {
      await resolveCaseAction(caseId, {
        status,
        closingMessage: closing,
        send,
        recipients: to,
        include,
        askSatisfaction: satisfaction,
      });
    });

  const preview = events.filter(
    (e) =>
      ((e.kind === 'customer_message' || e.kind === 'reply') && include.messages) ||
      (e.kind === 'status' && include.status) ||
      (e.kind === 'session' && include.sessions),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-page">{t('title')}</h1>
          <p className="m-0 text-fg-2">
            #{number} · {title} · {tenantName}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="m" asChild>
            <a href={`/platform/cases/${caseId}`}>{t('cancel')}</a>
          </Button>
          <Button variant="secondary" size="m" disabled={pending} onClick={() => submit(false)}>
            {t('resolveOnly')}
          </Button>
          <Button variant="primary" size="l" loading={pending} disabled={to.length === 0} onClick={() => submit(true)}>
            {!pending && <Icon icon={Mail} size={16} />}
            {t('resolveSend')}
          </Button>
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <h2 className="m-0 text-card">{t('recipients')}</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {recipients.map((r) => {
                const on = to.includes(r.userId);
                return (
                  <li key={r.userId}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTo(on ? to.filter((x) => x !== r.userId) : [...to, r.userId])}
                      className={cn(
                        'inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border-0 pl-1 pr-3 font-sans text-table',
                        on ? 'bg-fg-1 text-white' : 'bg-surface text-fg-1 shadow-ring-chip',
                      )}
                    >
                      <Avatar name={r.name} size={28} tone={on ? 'light' : 'navy'} />
                      <strong>{r.name}</strong>
                      <span className={on ? 'text-white' : 'text-fg-2'}>{r.email}</span>
                      <Icon icon={on ? X : Plus} size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 text-meta text-fg-2">{t('recipientsHelp')}</p>
          </Card>
          <Card className="flex flex-col gap-1">
            <h2 className="m-0 mb-2 text-card">{t('include')}</h2>
            {(
              [
                ['messages', t('incMessages'), t('incMessagesSub', { count: messages.length })],
                ['status', t('incStatus'), statuses.map((s) => s.body).join(', ') || '–'],
                ['sessions', t('incSessions'), t('incSessionsSub', { count: sessions.length })],
                ['time', t('incTime'), t('incTimeSub', { time: formatMinutes(minutes, locale) })],
              ] as const
            ).map(([key, label, sub]) => (
              <label key={key} className="flex items-start gap-3 border-t border-border py-3 first:border-0">
                <Checkbox
                  checked={include[key]}
                  onCheckedChange={(v) => setInclude({ ...include, [key]: v === true })}
                  aria-label={label}
                />
                <span className="flex flex-col">
                  <span className="text-body font-medium">{label}</span>
                  <span className="text-meta text-fg-2">{sub}</span>
                </span>
              </label>
            ))}
            <div className="flex items-start gap-3 border-t border-border py-3 text-fg-2">
              <Icon icon={Lock} size={16} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-body font-medium">{t('incNotes')}</span>
                <span className="text-meta">{t('incNotesSub', { count: internalNotes })}</span>
              </span>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-card">{t('closing')}</h2>
              <span className="text-meta text-fg-2">{t('optional')}</span>
            </div>
            <Textarea
              aria-label={t('closing')}
              rows={4}
              value={closing}
              placeholder={t('closingPlaceholder', { name: first?.name.split(' ')[0] ?? '' })}
              onChange={(e) => setClosing(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-3 text-table">
                {t('statusAfter')}
                <Segmented
                  aria-label={t('statusAfter')}
                  value={status}
                  onValueChange={(v) => setStatus(v as 'resolved' | 'closed')}
                  options={[
                    { value: 'resolved', label: t('resolved') },
                    { value: 'closed', label: t('closed') },
                  ]}
                />
              </span>
              <label className="flex items-center gap-2 text-table">
                <Checkbox checked={satisfaction} onCheckedChange={(v) => setSatisfaction(v === true)} />
                {t('askSatisfaction')}
              </label>
            </div>
            <p className="m-0 text-meta text-fg-2">{t('reopenHelp')}</p>
          </Card>
        </div>
        <Card padding="none" className="flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 shadow-hairline-b">
            <h2 className="m-0 text-table font-semibold">{t('preview')}</h2>
            <Segmented
              aria-label={t('preview')}
              tone="dark"
              value={device}
              onValueChange={(v) => setDevice(v as 'desktop' | 'mobile')}
              options={[
                { value: 'desktop', label: t('desktop') },
                { value: 'mobile', label: t('mobile') },
              ]}
            />
          </div>
          <div className="flex justify-center bg-bg-base p-6">
            <article className={cn('flex w-full flex-col gap-4 rounded-md bg-surface p-6 shadow-sm', device === 'mobile' ? 'max-w-sm' : 'max-w-xl')}>
              <p className="m-0 text-meta text-fg-2">
                <strong className="text-fg-1">{t('to')}</strong>{' '}
                {recipients
                  .filter((r) => to.includes(r.userId))
                  .map((r) => `${r.name} <${r.email}>`)
                  .join(', ') || '–'}
                <br />
                <strong className="text-fg-1">{t('subject')}</strong> {t('subjectLine', { title, n: number })}
              </p>
              <Logo />
              <p className="m-0 flex items-center gap-2 rounded-sm bg-ok-bg px-3 py-2 text-table font-semibold">
                <Icon icon={CircleCheck} size={16} className="text-ok-fg" />
                {t('mailResolved')}
              </p>
              {closing.trim() && <p className="m-0 whitespace-pre-wrap text-table">{closing}</p>}
              {preview.length > 0 && (
                <div className="flex flex-col">
                  <p className="eyebrow m-0 mb-1">{t('history')}</p>
                  {preview.map((e, i) => (
                    <div key={i} className="border-t border-border py-2.5 text-table">
                      <p className="m-0 text-meta">
                        <strong>{e.kind === 'session' ? t('agentorSupport') : e.kind === 'status' ? t('statusLabel') : e.authorName}</strong>{' '}
                        <span className="text-fg-2">{formatTime(new Date(e.createdAt), locale)}</span>
                      </p>
                      <p className="m-0 whitespace-pre-wrap">
                        {e.kind === 'session' ? e.body || t('sessionDefault') : e.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {include.time && (
                <p className="m-0 text-meta text-fg-2">{t('timeLine', { time: formatMinutes(minutes, locale) })}</p>
              )}
              {satisfaction && (
                <p className="m-0 text-table">
                  {t('satisfied')} <strong>{t('yes')}</strong> · <strong>{t('no')}</strong>
                </p>
              )}
              <p className="m-0 text-micro text-fg-2">{t('footer')}</p>
            </article>
          </div>
        </Card>
      </div>
    </>
  );
}
