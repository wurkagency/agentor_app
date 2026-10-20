'use client';

import { roundUpQuarter } from '@agentor/core';
import { formatHm, formatMinutes, type Locale } from '@agentor/i18n';
import { toast } from '@agentor/ui';
import {
  BigButton,
  ChipGroup,
  MobileField,
  MobileInput,
  MobileShell,
  Modal,
  Switch,
  TimerBar,
  TimerBarAction,
  TopBarAction,
} from '@agentor/ui/mobile';
import { Send, Timer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import {
  addCaseEventAction,
  addTimeAction,
  startTimerAction,
  stopTimerAction,
} from '../../actions';
import { PlatformTopBar } from '@/components/mobile/chrome';

const KINDS = ['phone', 'email', 'clarification', 'other'] as const;
type Kind = (typeof KINDS)[number];

function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * MP03 Sag and MP04 Tid: the navy bar with "Registrér tid", the timeline (server-rendered
 * children), the composer, and the timer bar at the bottom. "Stop og gem" and "Registrér tid"
 * open the same time modal; the timer only stops when the time is saved.
 */
export function CaseMobileShell({
  caseId,
  title,
  subtitle,
  caseLabel,
  plan,
  timer,
  contactName,
  children,
}: {
  caseId: string;
  title: string;
  subtitle: string;
  /** "#2291 · Nordlys Cykler ApS" under the modal title. */
  caseLabel: string;
  /** The customer's plan for "Fakturerbar tid"; null without one. */
  plan: string | null;
  /** The person's running timer, on this or another case. */
  timer: { caseId: string | null; startedAt: string } | null;
  /** Placeholder "Skriv til Mette". */
  contactName: string;
  children: ReactNode;
}) {
  const t = useTranslations('mobile.platform.case');
  const router = useRouter();
  const [modal, setModal] = useState<'timer' | 'manual' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.caseId === caseId ? timer : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const elapsed = running
    ? Math.max(0, Math.floor((now - new Date(running.startedAt).getTime()) / 1000))
    : 0;
  const [starting, start] = useTransition();

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/cases"
          title={title}
          subtitle={subtitle}
          actions={
            <TopBarAction
              icon={Timer}
              label={t('registerTime')}
              onNavy
              onClick={() => setModal('manual')}
            />
          }
        />
      }
      bottomBar={
        <TimerBar
          time={clock(elapsed)}
          label={t('timer')}
          action={
            running ? (
              <TimerBarAction
                onClick={() => {
                  setNow(Date.now());
                  setModal('timer');
                }}
              >
                {t('stopSave')}
              </TimerBarAction>
            ) : (
              <TimerBarAction
                onClick={() =>
                  start(async () => {
                    await startTimerAction(caseId);
                    router.refresh();
                  })
                }
              >
                {starting ? '…' : t('startTimer')}
              </TimerBarAction>
            )
          }
        />
      }
    >
      {children}
      <Composer caseId={caseId} contactName={contactName} />
      {modal && (
        <TimeModal
          caseId={caseId}
          caseLabel={caseLabel}
          plan={plan}
          elapsedSeconds={modal === 'timer' ? elapsed : null}
          onClose={() => setModal(null)}
        />
      )}
    </MobileShell>
  );
}

function Composer({ caseId, contactName }: { caseId: string; contactName: string }) {
  const t = useTranslations('mobile.platform.case');
  const tc = useTranslations('common');
  const router = useRouter();
  const [kind, setKind] = useState<'reply' | 'internal_note'>('reply');
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const res = await addCaseEventAction(caseId, { kind, body });
      if (!res.ok) return void toast.error({ title: t('failed'), closeLabel: tc('close') });
      setBody('');
      toast.info({ title: kind === 'reply' ? t('sent') : t('noted'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <form
      className="mt-auto flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send();
      }}
    >
      <ChipGroup
        label={t('kindLabel')}
        value={kind}
        onChange={(k) => setKind(k as 'reply' | 'internal_note')}
        items={[
          { key: 'reply', label: t('replyCustomer') },
          { key: 'internal_note', label: t('internalNote') },
        ]}
      />
      <div className="flex items-center gap-2">
        <input
          aria-label={kind === 'reply' ? t('replyCustomer') : t('internalNote')}
          placeholder={
            kind === 'reply' ? t('placeholderReply', { name: contactName }) : t('placeholderNote')
          }
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 font-sans text-m-input text-fg-1 outline-none focus-visible:shadow-focus"
        />
        <button
          type="submit"
          aria-label={t('send')}
          disabled={pending || !body.trim()}
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-primary text-fg-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send aria-hidden width={18} height={18} />
        </button>
      </div>
    </form>
  );
}

function TimeModal({
  caseId,
  caseLabel,
  plan,
  elapsedSeconds,
  onClose,
}: {
  caseId: string;
  caseLabel: string;
  plan: string | null;
  /** From the running timer; null for a manual entry. */
  elapsedSeconds: number | null;
  onClose: () => void;
}) {
  const t = useTranslations('mobile.platform.time');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const fromTimer =
    elapsedSeconds === null ? null : roundUpQuarter(Math.max(1, Math.ceil(elapsedSeconds / 60)));
  const [minutes, setMinutes] = useState(fromTimer ?? 15);
  const [kind, setKind] = useState<Kind>('phone');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(plan !== null);
  const [pending, start] = useTransition();
  const picks = [...new Set([15, 30, 60, ...(fromTimer ? [fromTimer] : [])])].sort((a, b) => a - b);
  const duration = formatMinutes(minutes, locale);
  const save = () =>
    start(async () => {
      const res =
        elapsedSeconds === null
          ? await addTimeAction({
              caseId,
              tenantId: null,
              workDate: new Date().toLocaleDateString('sv-SE'),
              minutes,
              kind,
              description,
              billable,
            })
          : await stopTimerAction(description, { minutes, kind, billable });
      if (!res.ok) return void toast.error({ title: t('failed'), closeLabel: tc('close') });
      toast.info({ title: t('saved', { duration }), closeLabel: tc('close') });
      onClose();
      router.refresh();
    });
  const elapsed =
    elapsedSeconds === null
      ? null
      : t('elapsed', { m: Math.floor(elapsedSeconds / 60), s: elapsedSeconds % 60 });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('title')}
      description={caseLabel}
      closeLabel={tc('close')}
      footer={
        <div className="grid grid-cols-m-actions gap-2">
          <BigButton variant="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
          <BigButton loading={pending} onClick={save}>
            {t('save', { duration })}
          </BigButton>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-1" aria-live="polite">
        <strong className="tabular text-stat">{formatHm(minutes)}</strong>
        <span className="text-meta text-fg-2">
          {elapsed ? t('stopped', { elapsed }) : t('manual')}
        </span>
      </div>
      <ChipGroup
        label={t('durationLabel')}
        value={String(minutes)}
        onChange={(k) => setMinutes(Number(k))}
        wrap
        center
        items={picks.map((m) => ({
          key: String(m),
          label:
            m === 15 ? t('quarter') : m === 30 ? t('half') : m === 60 ? t('hour') : formatHm(m),
        }))}
      />
      <ChipGroup
        label={t('kindLabel')}
        value={kind}
        onChange={(k) => setKind(k as Kind)}
        wrap
        center
        items={KINDS.map((k) => ({ key: k, label: t(`kinds.${k}`) }))}
      />
      <MobileField label={t('description')}>
        <MobileInput
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </MobileField>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <strong className="text-body">{t('billable')}</strong>
          {plan && <span className="text-meta text-fg-2">{t('plan', { plan })}</span>}
        </span>
        <Switch
          checked={billable}
          onCheckedChange={setBillable}
          label={t('billable')}
          disabled={plan === null}
        />
      </div>
    </Modal>
  );
}
