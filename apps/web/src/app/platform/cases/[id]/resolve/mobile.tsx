'use client';

import { formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import { Avatar, Icon, cn, toast } from '@agentor/ui';
import {
  BigButton,
  MOBILE_INPUT,
  MobileCard,
  MobileCallout,
  MobileCheckbox,
  MobileFootnote,
  MobileShell,
  Modal,
  Row,
  SectionHeading,
  Segmented,
  Switch,
} from '@agentor/ui/mobile';
import { CircleCheck, Info, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { resolveCaseAction } from '../../../actions';
import { Logo } from '@/components/logo';
import { PlatformTopBar } from '@/components/mobile/chrome';
import type { ResolveEvent } from '@/components/platform/resolve-form';

type Include = { messages: boolean; status: boolean; sessions: boolean; time: boolean };

/**
 * MP16 Løs sag (S8): recipients, what goes into the history (internal notes never), a closing
 * message and the status afterwards; "Forhåndsvis" shows exactly the e-mail the customer gets.
 * Same action and defaults as desktop.
 */
export function ResolveMobile({
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
  const tm = useTranslations('mobile.resolve');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const [to, setTo] = useState<string[]>(
    defaultRecipient ? [defaultRecipient] : recipients[0] ? [recipients[0].userId] : [],
  );
  const [include, setInclude] = useState<Include>({
    messages: true,
    status: true,
    sessions: true,
    time: false,
  });
  const [closing, setClosing] = useState('');
  const [status, setStatus] = useState<'resolved' | 'closed'>('resolved');
  const [satisfaction, setSatisfaction] = useState(true);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const messages = events.filter((e) => e.kind === 'customer_message' || e.kind === 'reply');
  const sessions = events.filter((e) => e.kind === 'session');
  const statuses = events.filter((e) => e.kind === 'status');
  const first = recipients.find((r) => r.userId === to[0]);
  const submit = (send: boolean) =>
    start(async () => {
      // Redirects to the case on success.
      const res = await resolveCaseAction(caseId, {
        status,
        closingMessage: closing,
        send,
        recipients: to,
        include,
        askSatisfaction: satisfaction,
      });
      if (res && !res.ok) toast.error({ title: tm('failed'), closeLabel: tc('close') });
    });
  const shown = events.filter(
    (e) =>
      ((e.kind === 'customer_message' || e.kind === 'reply') && include.messages) ||
      (e.kind === 'status' && include.status) ||
      (e.kind === 'session' && include.sessions),
  );
  const toggle = (key: keyof Include, label: string, meta: string) => (
    <Row
      key={key}
      title={label}
      meta={meta}
      trailing={
        <Switch
          checked={include[key]}
          onCheckedChange={(v) => setInclude({ ...include, [key]: v })}
          label={label}
        />
      }
    />
  );

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back={`/platform/cases/${caseId}`}
          title={tm('title')}
          subtitle={t('back', { n: number })}
          actions={
            <button
              type="button"
              onClick={() => setPreview(true)}
              className="touch-target flex-none cursor-pointer border-0 bg-transparent px-1 font-sans text-table font-semibold text-on-navy"
            >
              {tm('preview')}
            </button>
          }
        />
      }
    >
      <MobileFootnote>
        #{number} · {title} · {tenantName}
      </MobileFootnote>

      <SectionHeading>{t('recipients')}</SectionHeading>
      {recipients.length === 0 ? (
        <MobileCallout tone="info" icon={Info} title={tm('noRecipients')} />
      ) : (
        <MobileCard>
          {recipients.map((r) => {
            const on = to.includes(r.userId);
            return (
              <Row
                key={r.userId}
                leading={<Avatar name={r.name} size={32} />}
                title={r.name}
                meta={r.email}
                trailing={
                  <MobileCheckbox
                    checked={on}
                    label={r.name}
                    onCheckedChange={() =>
                      setTo(on ? to.filter((x) => x !== r.userId) : [...to, r.userId])
                    }
                  />
                }
              />
            );
          })}
        </MobileCard>
      )}

      <SectionHeading>{tm('include')}</SectionHeading>
      <MobileCard>
        {toggle('messages', tm('messages'), t('incMessagesSub', { count: messages.length }))}
        {toggle('status', t('incStatus'), statuses.map((s) => s.body).join(', ') || '–')}
        {toggle('sessions', tm('sessions'), tm('sessionsSub', { count: sessions.length }))}
        {toggle('time', t('incTime'), tm('timeSub', { time: formatMinutes(minutes, locale) }))}
        <Row
          title={t('incNotes')}
          meta={tm('notesSub', { count: internalNotes })}
          trailing={<Switch checked={false} disabled label={t('incNotes')} />}
        />
      </MobileCard>

      <label className="mt-1.5 flex flex-col gap-1.5 text-table font-semibold">
        {t('closing')}
        <textarea
          value={closing}
          maxLength={5000}
          rows={4}
          placeholder={t('closingPlaceholder', { name: first?.name.split(' ')[0] ?? '' })}
          onChange={(e) => setClosing(e.target.value)}
          className={cn(MOBILE_INPUT, 'h-24 resize-none py-2.5 leading-snug')}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <strong className="mx-1 text-table">{t('statusAfter')}</strong>
        <Segmented
          label={t('statusAfter')}
          value={status}
          onChange={(k) => setStatus(k as 'resolved' | 'closed')}
          items={[
            { key: 'resolved', label: t('resolved') },
            { key: 'closed', label: t('closed') },
          ]}
        />
      </div>
      <MobileCard>
        <Row
          title={t('askSatisfaction')}
          trailing={
            <Switch
              checked={satisfaction}
              onCheckedChange={setSatisfaction}
              label={t('askSatisfaction')}
            />
          }
        />
      </MobileCard>
      <MobileFootnote>{t('reopenHelp')}</MobileFootnote>

      {/* Stays at the bottom of the screen while scrolling (MP16 action bar). */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-auto bg-surface px-4 pb-bar-safe shadow-hairline-t">
        <div className="grid grid-cols-2 gap-2.5 pb-5 pt-3">
          <BigButton variant="secondary" disabled={pending} onClick={() => submit(false)}>
            {t('resolveOnly')}
          </BigButton>
          <BigButton
            icon={Send}
            loading={pending}
            disabled={to.length === 0}
            onClick={() => submit(true)}
          >
            {tm('resolveSend')}
          </BigButton>
        </div>
      </div>

      <Modal open={preview} onOpenChange={setPreview} title={t('preview')} closeLabel={tc('close')}>
        <article className="flex flex-col gap-4">
          <p className="m-0 text-meta text-fg-2">
            <strong className="text-fg-1">{t('to')}</strong>{' '}
            {recipients
              .filter((r) => to.includes(r.userId))
              .map((r) => `${r.name} <${r.email}>`)
              .join(', ') || '–'}
            <br />
            <strong className="text-fg-1">{t('subject')}</strong>{' '}
            {t('subjectLine', { title, n: number })}
          </p>
          <Logo />
          <p className="m-0 flex items-center gap-2 rounded-sm bg-ok-bg px-3 py-2 text-table font-semibold">
            <Icon icon={CircleCheck} size={16} className="text-ok-fg" />
            {t('mailResolved')}
          </p>
          {closing.trim() && <p className="m-0 whitespace-pre-wrap text-table">{closing}</p>}
          {shown.length > 0 && (
            <div className="flex flex-col">
              <p className="eyebrow m-0 mb-1">{t('history')}</p>
              {shown.map((e, i) => (
                <div key={i} className="border-t border-border py-2.5 text-table">
                  <p className="m-0 text-meta">
                    <strong>
                      {e.kind === 'session'
                        ? t('agentorSupport')
                        : e.kind === 'status'
                          ? t('statusLabel')
                          : e.authorName}
                    </strong>{' '}
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
            <p className="m-0 text-meta text-fg-2">
              {t('timeLine', { time: formatMinutes(minutes, locale) })}
            </p>
          )}
          {satisfaction && (
            <p className="m-0 text-table">
              {t('satisfied')} <strong>{t('yes')}</strong> · <strong>{t('no')}</strong>
            </p>
          )}
          <p className="m-0 text-micro text-fg-2">{t('footer')}</p>
        </article>
      </Modal>
    </MobileShell>
  );
}
