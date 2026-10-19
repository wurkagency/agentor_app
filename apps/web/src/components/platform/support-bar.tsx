'use client';

import { formatHm, formatMinutes, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Icon,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Switch,
  cn,
} from '@agentor/ui';
import { ArrowLeftRight, Clock, Eye, Lock, LogOut, Pencil, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  endSupportViewAction,
  openAsSuperadminAction,
  openSupportViewAction,
  supportSessionInfoAction,
  type SessionEndInfo,
} from '@/app/platform/actions';

export interface SwitcherGrant {
  grantId: string;
  tenantId: string;
  tenantName: string;
  initials: string;
  caseRef: string;
  state: string;
  expiresAt: string;
}

/**
 * Supportvisning (P4): a navy bar above the customer's own app that can't be hidden. Shows the
 * customer, the case, who approved it and how long access lasts; ⌘J switches customer (P5);
 * "Afslut supportvisning" logs the time (S5).
 */
export function SupportBar({
  tenantName,
  initials,
  scope,
  caseRef,
  approvedBy,
  superadmin = false,
  expiresAt,
  grants,
}: {
  tenantName: string;
  initials: string;
  scope: 'view' | 'help';
  caseRef: string;
  approvedBy: string | null;
  superadmin?: boolean;
  expiresAt: string;
  grants: SwitcherGrant[];
}) {
  const t = useTranslations('platform.supportBar');
  const locale = useLocale() as Locale;
  const [now, setNow] = useState(() => Date.now());
  const [switcher, setSwitcher] = useState(false);
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setSwitcher((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const hoursLeft = Math.floor(left / 3_600_000);
  const minutesLeft = Math.floor((left % 3_600_000) / 60_000);

  return (
    <div
      role="region"
      aria-label={t('label')}
      className="on-navy sticky top-0 z-40 flex-none bg-navy px-gutter text-on-navy"
    >
      <div className="mx-auto flex min-h-13 max-w-content flex-wrap items-center gap-x-5 gap-y-2 py-2 text-table">
        <span className="flex items-center gap-2 font-semibold">
          <Icon icon={Eye} size={16} />
          {t('title')}
        </span>
        <Popover open={switcher} onOpenChange={setSwitcher}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('switch', { name: tenantName })}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-full border-0 bg-on-navy/10 pl-1.5 pr-3 font-sans text-table font-semibold text-on-navy"
            >
              <span className="grid size-6 place-items-center rounded-sm bg-surface text-micro text-fg-1">
                {initials}
              </span>
              {tenantName}
              <Kbd>⌘J</Kbd>
              <Icon icon={ArrowLeftRight} size={14} className="text-on-navy-muted" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 p-0">
            <Switcher
              grants={grants}
              now={now}
              locale={locale}
              onClose={() => setSwitcher(false)}
            />
          </PopoverContent>
        </Popover>
        <span className="text-on-navy-muted">
          {superadmin
            ? t('contextSuperadmin')
            : t('context', {
                scope: t(`scope.${scope}`),
                case: caseRef,
                by: approvedBy ?? t('autoApproved'),
              })}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 font-semibold" aria-live="polite">
            <Icon icon={Clock} size={16} />
            {hoursLeft > 0
              ? t('leftHours', { h: hoursLeft })
              : t('leftMinutes', { m: minutesLeft })}
          </span>
          <span className="text-on-navy-muted">{t('logged')}</span>
          <Button variant="primary" size="s" onClick={() => setEnding(true)}>
            <Icon icon={LogOut} size={14} />
            {t('end')}
          </Button>
        </span>
      </div>
      {ending && <EndSessionDialog onClose={() => setEnding(false)} />}
    </div>
  );
}

function Switcher({
  grants,
  now,
  locale,
  onClose,
}: {
  grants: SwitcherGrant[];
  now: number;
  locale: Locale;
  onClose: () => void;
}) {
  const t = useTranslations('platform.supportBar');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  const list = grants.filter((g) => g.tenantName.toLowerCase().includes(q.trim().toLowerCase()));
  const active = list.filter((g) => g.state === 'active');
  const others = list.filter((g) => g.state !== 'active' && g.state !== 'direct');
  const direct = list.filter((g) => g.state === 'direct');
  const pick = (g: SwitcherGrant) =>
    g.state === 'active'
      ? start(async () => void (await openSupportViewAction(g.grantId)))
      : g.state === 'direct'
        ? start(async () => void (await openAsSuperadminAction(g.tenantId)))
        : (onClose(), router.push(`/platform/customers/${g.tenantId}`));
  const row = (g: SwitcherGrant) => (
    <li key={g.grantId}>
      <button
        type="button"
        disabled={pending}
        onClick={() => pick(g)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-sm border-0 bg-transparent px-3 py-2 text-left font-sans text-table text-fg-1 hover:bg-row-hover"
      >
        <span className="w-6 text-micro font-semibold text-fg-2">{g.initials}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{g.tenantName}</span>
          <span className="text-meta text-fg-2">{g.caseRef}</span>
        </span>
        <span className="flex items-center gap-1 text-meta text-fg-2">
          {g.state === 'direct' ? (
            <>
              <Icon icon={Eye} size={14} />
              {t('direct')}
            </>
          ) : g.state === 'active' ? (
            <>
              <Icon icon={Clock} size={14} />
              {formatRelative(new Date(g.expiresAt), new Date(now), locale)}
            </>
          ) : g.state === 'pending' ? (
            <>
              <Icon icon={Clock} size={14} />
              {t('pending')}
            </>
          ) : (
            <>
              <Icon icon={Lock} size={14} />
              {t('request')}
            </>
          )}
        </span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col">
      <label className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Icon icon={Search} size={16} className="text-fg-2" />
        <span className="sr-only">{t('search')}</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          className="flex-1 border-0 bg-transparent font-sans text-table text-fg-1 outline-none"
        />
        <Kbd>Esc</Kbd>
      </label>
      <div className="max-h-96 overflow-y-auto p-1.5">
        {active.length > 0 && (
          <>
            <p className="m-0 px-3 pb-1 pt-2 text-micro font-semibold text-fg-2">
              {t('activeGrants')}
            </p>
            <ul className="m-0 list-none p-0">{active.map(row)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <p className="m-0 px-3 pb-1 pt-2 text-micro font-semibold text-fg-2">{t('recent')}</p>
            <ul className="m-0 list-none p-0">{others.map(row)}</ul>
          </>
        )}
        {direct.length > 0 && (
          <>
            <p className="m-0 px-3 pb-1 pt-2 text-micro font-semibold text-fg-2">
              {t('allCustomers')}
            </p>
            <ul className="m-0 list-none p-0">{direct.map(row)}</ul>
          </>
        )}
      </div>
      <p className="m-0 flex justify-between border-t border-border px-3 py-2 text-micro text-fg-2">
        <span>{t('keys')}</span>
        <span>{t('withoutAccess')}</span>
      </p>
    </div>
  );
}

/** Turns a visited path into a line in the session log (S5). */
function actionLabel(t: (k: string, p?: Record<string, string>) => string, label: string) {
  if (label === 'opened') return t('action.opened');
  if (label === '/') return t('action.overview');
  if (/^\/integrations\/[^/]+\/editor/.test(label)) return t('action.editor');
  if (/^\/integrations\/[^/]+/.test(label)) return t('action.flow');
  if (label.startsWith('/integrations')) return t('action.integrations');
  if (label.startsWith('/activity')) return t('action.activity');
  if (label.startsWith('/connections')) return t('action.connections');
  return label;
}

const parseHm = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.trim());
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Afslut supportsession (S5): logged time, what happened, the case and a short summary. */
function EndSessionDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('platform.supportBar');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const [info, setInfo] = useState<SessionEndInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string>('none');
  const [time, setTime] = useState('0:01');
  const [summary, setSummary] = useState('');
  const [billable, setBillable] = useState(true);
  const [endGrant, setEndGrant] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    void supportSessionInfoAction().then((res) => {
      if (!res.ok) return setError(res.error);
      setInfo(res.data!);
      setCaseId(res.data!.caseId ?? res.data!.cases[0]?.id ?? 'none');
      setTime(formatHm(res.data!.minutes));
    });
  }, []);

  const minutes = parseHm(time);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  const actions = useMemo(() => (info ? info.actions.slice(-7) : []), [info]);
  const caseLabel = info?.cases.find((c) => c.id === caseId)?.label.split(' ')[0];
  const submit = (discard: boolean) =>
    start(async () => {
      const res = await endSupportViewAction({
        minutes: valid ? minutes : 1,
        caseId: caseId === 'none' ? null : caseId,
        summary,
        billable,
        endGrant,
        discard,
      });
      if (res && !res.ok) setError(res.error);
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={560}
      title={t('endTitle')}
      description={
        info
          ? `${info.tenantName} · ${formatTime(new Date(info.startedAt), locale)}–${formatTime(new Date(info.lastActionAt), locale)}`
          : undefined
      }
      closeLabel={tc('close')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="m" onClick={onClose}>
            {t('continue')}
          </Button>
          <span className="flex gap-2">
            <Button
              variant="ghost"
              size="m"
              disabled={pending || !info}
              onClick={() => submit(true)}
            >
              {t('discard')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!info || !valid}
              onClick={() => submit(false)}
            >
              {caseLabel
                ? t('saveOnCase', {
                    time: formatMinutes(valid ? minutes : 0, locale),
                    case: caseLabel,
                  })
                : t('save', { time: formatMinutes(valid ? minutes : 0, locale) })}
            </Button>
          </span>
        </div>
      }
    >
      {error && <p className="m-0 text-table text-error-fg">{t('error')}</p>}
      {info && (
        <>
          <div className="flex items-start gap-3 rounded-md bg-bg-base px-4 py-3">
            <Icon icon={Clock} size={24} className="mt-1" />
            <span className="flex flex-col">
              <strong className="text-section">{formatMinutes(info.minutes, locale)}</strong>
              <span className="text-meta text-fg-2">{t('autoLogged')}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-table font-semibold">
              {t('actions', { count: info.actions.length })}
            </p>
            <ul className="m-0 list-none p-0">
              {actions.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 border-t border-border py-1.5 text-table first:border-0"
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      icon={a.label.includes('editor') ? Pencil : Eye}
                      size={14}
                      className="text-fg-2"
                    />
                    {actionLabel(t, a.label)}
                  </span>
                  <span className="tabular text-meta text-fg-2">
                    {formatTime(new Date(a.at), locale)}
                  </span>
                </li>
              ))}
            </ul>
            {info.actions.length > actions.length && (
              <p className="m-0 text-meta text-fg-2">
                {t('more', { count: info.actions.length - actions.length })}
              </p>
            )}
          </div>
          <Field label={t('linkCase')} inline>
            {({ id }) => (
              <Select
                id={id}
                value={caseId}
                onValueChange={setCaseId}
                options={[
                  ...info.cases.map((c) => ({ value: c.id, label: c.label })),
                  { value: 'none', label: t('noCase') },
                ]}
              />
            )}
          </Field>
          <Field label={t('time')} help={t('timeHelp')} inline>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                className={cn('w-24 tabular', !valid && 'shadow-ring-error-2')}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('summary')} help={t('summaryHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                maxLength={500}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center justify-between gap-3 text-table">
            {t('billable')}
            <Switch checked={billable} onCheckedChange={setBillable} aria-label={t('billable')} />
          </label>
          <label className="flex items-center gap-2.5 text-table">
            <Checkbox checked={endGrant} onCheckedChange={(v) => setEndGrant(v === true)} />
            <span>
              {t('endGrant')}{' '}
              <span className="text-fg-2">
                {t('endGrantHelp', {
                  when: formatRelative(new Date(info.expiresAt), new Date(), locale),
                })}
              </span>
            </span>
          </label>
        </>
      )}
    </Dialog>
  );
}
