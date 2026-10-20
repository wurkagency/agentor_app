'use client';

import { roundUpQuarter } from '@agentor/core';
import { formatHm, formatMinutes, type Locale } from '@agentor/i18n';
import { cn, toast } from '@agentor/ui';
import {
  BigButton,
  CardButton,
  ChipGroup,
  MOBILE_INPUT,
  MobileField,
  MobileInput,
  Modal,
  Switch,
} from '@agentor/ui/mobile';
import { Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { addTimeAction, linkSessionAction, stopTimerAction, updateTimeAction } from '../actions';

const KINDS = ['phone', 'email', 'clarification', 'meeting', 'other'] as const;
type Kind = (typeof KINDS)[number] | 'session';
type CaseOption = { id: string; label: string };

const pad = (n: number) => String(n).padStart(2, '0');
function clock(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(pad)
    .join(':');
}
const elapsedSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));

/** "00:12:40" since a start, ticking each second. */
export function LiveClock({ startedAt }: { startedAt: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    setSeconds(elapsedSince(startedAt));
    const id = setInterval(() => setSeconds(elapsedSince(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  // Rendered on the server without a clock, so the first paint matches.
  return <span className="tabular">{seconds === null ? '–' : clock(seconds)}</span>;
}

type ModalMode =
  | { kind: 'new'; cases: CaseOption[] }
  | { kind: 'edit'; id: string }
  | { kind: 'stop'; elapsedSeconds: number };

/**
 * The time sheet (MP04 pattern): duration chips with the exact minutes as override, type,
 * description and billable. A stopped timer starts at its time rounded up to 15 min. (B1).
 */
function TimeModal({
  mode,
  title,
  description,
  initial,
  hasCustomer,
  onClose,
}: {
  mode: ModalMode;
  title: string;
  description: string;
  initial: { minutes: number; kind: Kind; description: string; billable: boolean };
  /** Billable time needs a customer; for a new entry it follows the picked case. */
  hasCustomer: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('mobile.platform.time');
  const tm = useTranslations('mobile.myTime');
  const tk = useTranslations('platform.time.kind');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [minutes, setMinutes] = useState(initial.minutes);
  const [typed, setTyped] = useState(String(initial.minutes));
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [text, setText] = useState(initial.description);
  const [billable, setBillable] = useState(initial.billable);
  const [caseId, setCaseId] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [pending, start] = useTransition();
  const customer = mode.kind === 'new' ? caseId !== '' : hasCustomer;
  const picks = [...new Set([15, 30, 45, 60, initial.minutes])].sort((a, b) => a - b);
  const kinds: Kind[] = initial.kind === 'session' ? ['session', ...KINDS] : [...KINDS];
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  const duration = formatMinutes(minutes, locale);
  const setBoth = (m: number) => {
    setMinutes(m);
    setTyped(String(m));
  };
  const save = () =>
    start(async () => {
      const bill = billable && customer;
      const res =
        mode.kind === 'new'
          ? await addTimeAction({
              caseId: caseId || null,
              tenantId: null,
              workDate: date,
              minutes,
              kind: kind === 'session' ? 'other' : kind,
              description: text,
              billable: bill,
            })
          : mode.kind === 'edit'
            ? await updateTimeAction(mode.id, { minutes, kind, description: text, billable: bill })
            : await stopTimerAction(text, {
                minutes,
                kind: kind === 'session' ? 'other' : kind,
                billable: bill,
              });
      if (!res.ok) return void toast.error({ title: t('failed'), closeLabel: tc('close') });
      toast.info({ title: tm('saved', { duration }), closeLabel: tc('close') });
      onClose();
      router.refresh();
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      closeLabel={tc('close')}
      footer={
        <div className="grid grid-cols-m-actions gap-2">
          <BigButton variant="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
          <BigButton loading={pending} disabled={!valid} onClick={save}>
            {valid ? t('save', { duration }) : tm('saveShort')}
          </BigButton>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-1" aria-live="polite">
        <strong className="tabular text-stat">{valid ? formatHm(minutes) : '–'}</strong>
        <span className="text-meta text-fg-2">
          {mode.kind === 'stop'
            ? t('stopped', {
                elapsed: t('elapsed', {
                  m: Math.floor(mode.elapsedSeconds / 60),
                  s: mode.elapsedSeconds % 60,
                }),
              })
            : t('manual')}
        </span>
      </div>
      <ChipGroup
        label={t('durationLabel')}
        value={String(minutes)}
        onChange={(k) => setBoth(Number(k))}
        wrap
        center
        items={picks.map((m) => ({
          key: String(m),
          label:
            m === 15 ? t('quarter') : m === 30 ? t('half') : m === 60 ? t('hour') : formatHm(m),
        }))}
      />
      <MobileField label={tm('minutes')} hint={tm('minutesHint')}>
        <MobileInput
          inputMode="numeric"
          className="tabular"
          value={typed}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
            setTyped(v);
            setMinutes(Number(v));
          }}
        />
      </MobileField>
      {mode.kind === 'new' && (
        <>
          <MobileField label={tm('case')}>
            <select
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setBillable(e.target.value !== '');
              }}
              className={cn(MOBILE_INPUT, 'cursor-pointer')}
            >
              <option value="">{tm('noCase')}</option>
              {mode.cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </MobileField>
          <MobileField label={tm('date')}>
            <MobileInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </MobileField>
        </>
      )}
      <ChipGroup
        label={t('kindLabel')}
        value={kind}
        onChange={(k) => setKind(k as Kind)}
        wrap
        center
        items={kinds.map((k) => ({ key: k, label: tk(k) }))}
      />
      <MobileField label={t('description')}>
        <MobileInput value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      </MobileField>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <strong className="text-body">{t('billable')}</strong>
          {!customer && <span className="text-meta text-fg-2">{tm('billableNeedsCase')}</span>}
        </span>
        <Switch
          checked={billable && customer}
          onCheckedChange={setBillable}
          label={t('billable')}
          disabled={!customer}
        />
      </div>
    </Modal>
  );
}

/** "Registrér tid" floating over the list, 12 px above the tab bar (MP15). */
export function RegisterTimeFab({ cases }: { cases: CaseOption[] }) {
  const t = useTranslations('mobile.platform.time');
  const tm = useTranslations('mobile.myTime');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-tabbar-gap right-4 z-20 flex h-13 cursor-pointer items-center gap-2 rounded-full border-0 bg-primary px-5.5 font-sans text-nav font-semibold text-fg-1 shadow-modal hover:bg-primary-bright"
      >
        <Plus aria-hidden width={18} height={18} />
        {t('title')}
      </button>
      {open && (
        <TimeModal
          mode={{ kind: 'new', cases }}
          title={t('title')}
          description={tm('newHelp')}
          initial={{ minutes: 15, kind: 'phone', description: '', billable: false }}
          hasCustomer={false}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** "Ret tid" in an unfolded entry (MP15). */
export function EditTimeButton({
  entry,
}: {
  entry: {
    id: string;
    minutes: number;
    kind: Kind;
    description: string;
    billable: boolean;
    hasCustomer: boolean;
    label: string;
  };
}) {
  const tm = useTranslations('mobile.myTime');
  const [open, setOpen] = useState(false);
  return (
    <>
      <CardButton icon={Pencil} onClick={() => setOpen(true)}>
        {tm('edit')}
      </CardButton>
      {open && (
        <TimeModal
          mode={{ kind: 'edit', id: entry.id }}
          title={tm('edit')}
          description={entry.label}
          initial={entry}
          hasCustomer={entry.hasCustomer}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** "Stop og gem" on the running case timer: rounded up to 15 min., can be changed (B1). */
export function StopTimerButton({
  startedAt,
  caseLabel,
  hasCustomer,
}: {
  startedAt: string;
  caseLabel: string;
  hasCustomer: boolean;
}) {
  const t = useTranslations('mobile.platform.time');
  const tm = useTranslations('mobile.myTime');
  const [elapsed, setElapsed] = useState<number | null>(null);
  return (
    <>
      <CardButton variant="dark" onClick={() => setElapsed(elapsedSince(startedAt))}>
        {tm('stopSave')}
      </CardButton>
      {elapsed !== null && (
        <TimeModal
          mode={{ kind: 'stop', elapsedSeconds: elapsed }}
          title={t('title')}
          description={caseLabel}
          initial={{
            minutes: Math.min(1440, roundUpQuarter(Math.max(1, Math.ceil(elapsed / 60)))),
            kind: 'phone',
            description: '',
            billable: hasCustomer,
          }}
          hasCustomer={hasCustomer}
          onClose={() => setElapsed(null)}
        />
      )}
    </>
  );
}

/** "Knyt til sag" for a logged session without a case (MP15, S6). */
export function LinkSessionButton({
  sessionId,
  cases,
}: {
  sessionId: string;
  cases: CaseOption[];
}) {
  const t = useTranslations('platform.time');
  const tm = useTranslations('mobile.myTime');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const [pending, start] = useTransition();
  return (
    <>
      <CardButton onClick={() => setOpen(true)} disabled={cases.length === 0}>
        {t('link')}
      </CardButton>
      {cases.length === 0 && (
        <span className="self-center text-meta font-medium text-fg-2">{tm('noOpenCases')}</span>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('link')}
        description={t('linkHelp')}
        closeLabel={tc('close')}
        footer={
          <div className="grid grid-cols-m-actions gap-2">
            <BigButton variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </BigButton>
            <BigButton
              loading={pending}
              disabled={!caseId}
              onClick={() =>
                start(async () => {
                  const res = await linkSessionAction(sessionId, caseId);
                  if (!res.ok)
                    return void toast.error({ title: t('error'), closeLabel: tc('close') });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {t('link')}
            </BigButton>
          </div>
        }
      >
        <MobileField label={t('case')}>
          <select
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            className={cn(MOBILE_INPUT, 'cursor-pointer')}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </MobileField>
      </Modal>
    </>
  );
}
