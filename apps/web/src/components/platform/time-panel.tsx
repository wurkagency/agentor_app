'use client';

import { formatHm, formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import { Button, Card, Dialog, Field, Icon, Input, Segmented, Switch, toast } from '@agentor/ui';
import { Eye, Mail, Pencil, Phone, Play, Plus, Square, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { addTimeAction, startTimerAction, stopTimerAction } from '@/app/platform/actions';

export interface TimeRow {
  id: string;
  kind: string;
  source: 'auto' | 'manual' | 'timer';
  staffName: string;
  description: string;
  minutes: number;
  createdAt: string;
  billable: boolean;
}

const KIND_ICON = {
  session: Eye,
  phone: Phone,
  email: Mail,
  clarification: Pencil,
  meeting: Users,
  other: Pencil,
};

/** Tid på sagen (S3) with "Tilføj tid" (S4) and the timer. */
export function TimePanel({
  caseId,
  caseLabel,
  plan,
  entries,
  timer,
}: {
  caseId: string;
  caseLabel: string;
  plan: string;
  entries: TimeRow[];
  timer: { caseId: string | null; startedAt: string } | null;
}) {
  const t = useTranslations('platform.time');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.caseId === caseId ? timer : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const elapsed = running ? Math.floor((now - new Date(running.startedAt).getTime()) / 1000) : 0;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-card">{t('onCase')}</h2>
        <strong className="text-section">{formatMinutes(total, locale)}</strong>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {entries.map((e) => {
          const KindIcon = KIND_ICON[e.kind as keyof typeof KIND_ICON] ?? Pencil;
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 border-t border-border py-3 first:border-0"
            >
              <Icon icon={KindIcon} size={16} className="mt-0.5 text-fg-2" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-2 text-table font-medium">
                  {e.description || t(`kind.${e.kind}`)}
                  <span
                    className={
                      e.source === 'auto'
                        ? 'rounded-full bg-navy px-2 py-px text-micro font-semibold text-on-navy'
                        : 'rounded-full bg-bg-base px-2 py-px text-micro font-semibold shadow-ring-chip'
                    }
                  >
                    {t(`source.${e.source}`)}
                  </span>
                  {e.billable && (
                    <span className="text-micro font-semibold text-fg-2">{t('billableShort')}</span>
                  )}
                </span>
                <span className="text-meta text-fg-2">
                  {e.staffName.split(' ')[0]} · {formatTime(new Date(e.createdAt), locale)}
                </span>
              </span>
              <span className="text-table font-semibold">{formatMinutes(e.minutes, locale)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="s" onClick={() => setAdding(true)}>
          <Icon icon={Plus} size={14} />
          {t('add')}
        </Button>
        {running ? (
          <Button
            variant="secondary"
            size="s"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await stopTimerAction(caseLabel);
                if (res.ok && res.data?.minutes)
                  toast.ok({
                    title: t('timerSaved', { time: formatMinutes(res.data.minutes, locale) }),
                    closeLabel: tc('close'),
                  });
                router.refresh();
              })
            }
          >
            <Icon icon={Square} size={14} />
            {t('stopTimer', {
              time:
                formatHm(Math.floor(elapsed / 60)) + `:${String(elapsed % 60).padStart(2, '0')}`,
            })}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="s"
            loading={pending}
            onClick={() =>
              start(async () => {
                await startTimerAction(caseId);
                router.refresh();
              })
            }
          >
            <Icon icon={Play} size={14} />
            {t('startTimer')}
          </Button>
        )}
      </div>
      <p className="m-0 text-meta text-fg-2">{t('autoNote')}</p>
      {adding && (
        <AddTimeDialog
          caseId={caseId}
          caseLabel={caseLabel}
          plan={plan}
          total={total}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  );
}

/** Tilføj tid (S4): duration with quick picks, date, type, description, billable. */
export function AddTimeDialog({
  caseId,
  caseLabel,
  plan,
  total,
  onClose,
}: {
  caseId: string | null;
  caseLabel: string;
  plan: string;
  total: number;
  onClose: () => void;
}) {
  const t = useTranslations('platform.time');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [duration, setDuration] = useState('0:15');
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState('phone');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [pending, start] = useTransition();
  const m = /^(\d{1,2}):(\d{2})$/.exec(duration.trim());
  const minutes = m ? Number(m[1]) * 60 + Number(m[2]) : Number(duration) || 0;
  const valid = minutes >= 1 && minutes <= 1440;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={640}
      title={t('add')}
      description={caseLabel}
      closeLabel={tc('close')}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-fg-2">
            {t('caseTotal', { time: formatMinutes(total + (valid ? minutes : 0), locale) })}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" size="m" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!valid}
              onClick={() =>
                start(async () => {
                  const res = await addTimeAction({
                    caseId,
                    tenantId: null,
                    workDate: date,
                    minutes,
                    kind: kind as 'phone',
                    description,
                    billable,
                  });
                  if (!res.ok)
                    return void toast.error({ title: t('error'), closeLabel: tc('close') });
                  onClose();
                  router.refresh();
                })
              }
            >
              {t('save')}
            </Button>
          </span>
        </div>
      }
    >
      <Field label={t('duration')} inline>
        {({ id }) => (
          <span className="flex flex-wrap items-center gap-2">
            <Input
              id={id}
              className="w-24 tabular"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            {[15, 30, 60].map((q) => (
              <Button
                key={q}
                variant={minutes === q ? 'primary' : 'secondary'}
                size="s"
                onClick={() => setDuration(formatHm(q))}
              >
                {q === 60 ? t('hour') : t('quick', { count: q })}
              </Button>
            ))}
          </span>
        )}
      </Field>
      <Field label={t('date')} inline>
        {({ id }) => (
          <input
            id={id}
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-sm border-0 bg-surface px-3 font-sans text-table text-fg-1 shadow-ring-chip"
          />
        )}
      </Field>
      <Field label={t('type')} inline>
        {() => (
          <Segmented
            aria-label={t('type')}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'phone', label: t('kind.phone'), icon: <Icon icon={Phone} size={14} /> },
              { value: 'email', label: t('kind.email'), icon: <Icon icon={Mail} size={14} /> },
              {
                value: 'clarification',
                label: t('kind.clarification'),
                icon: <Icon icon={Pencil} size={14} />,
              },
              { value: 'other', label: t('kind.other') },
            ]}
          />
        )}
      </Field>
      <Field label={t('description')}>
        {({ id }) => (
          <Input
            id={id}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <label className="flex items-center justify-between gap-3 text-table">
        <span className="flex items-center gap-2">
          {t('billable')}
          <span className="rounded-full bg-bg-base px-2 py-0.5 text-micro font-semibold shadow-ring-chip">
            {t('plan', { plan })}
          </span>
        </span>
        <Switch checked={billable} onCheckedChange={setBillable} aria-label={t('billable')} />
      </label>
    </Dialog>
  );
}
