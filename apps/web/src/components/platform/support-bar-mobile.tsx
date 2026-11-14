'use client';

import { formatDate, formatMinutes, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { cn } from '@agentor/ui';
import {
  BigButton,
  ExpandCard,
  KV,
  MobileCard,
  MobileCheckbox,
  MobileField,
  MobileInput,
  MobileFootnote,
  Modal,
  RowsSkeleton,
  SectionHeading,
  Switch,
} from '@agentor/ui/mobile';
import { ArrowLeftRight, Clock, Eye, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  endSupportViewAction,
  openAsSuperadminAction,
  openSupportViewAction,
  supportSessionInfoAction,
  type SessionEndInfo,
} from '@/app/platform/actions';
import { MobileSelect, MobileTextarea } from '@/components/mobile/native-select';
import { useNow } from '@/components/now';
import { actionLabel, type SwitcherGrant } from './support-bar';

/**
 * MP10 Supportvisning on a phone: the lime bar above the customer's own mobile screens, with the
 * customer, scope, case and time left; "Skift kunde" (MP11) and "Afslut" (MP14). It stays at the
 * top while the page scrolls, like the navy bar on desktop (P4).
 */
export function SupportBarMobile({
  tenantName,
  initials,
  scope,
  caseRef,
  superadmin = false,
  expiresAt,
  grants,
}: {
  tenantName: string;
  initials: string;
  scope: 'view' | 'help';
  caseRef: string;
  superadmin?: boolean;
  expiresAt: string;
  grants: SwitcherGrant[];
}) {
  const t = useTranslations('mobile.supportView');
  const tb = useTranslations('platform.supportBar');
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<'switch' | 'end' | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const left = h > 0 ? t('leftHours', { h }) : t('leftMinutes', { m: Math.floor(ms / 60_000) });

  return (
    <div
      role="region"
      aria-label={tb('label')}
      className="sticky top-0 z-40 flex h-13 flex-none items-center gap-2 bg-primary pl-4 pr-2 text-fg-1"
    >
      <span
        aria-hidden
        className="grid size-6.5 flex-none place-items-center rounded-sm bg-surface text-micro font-semibold"
      >
        {initials}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <strong className="truncate text-meta">{t('title', { name: tenantName })}</strong>
        <span className="truncate text-meta font-medium" aria-live="polite">
          {superadmin
            ? t('contextSuperadmin')
            : t('context', { scope: tb(`scope.${scope}`), case: caseRef, left })}
        </span>
      </span>
      <button
        type="button"
        aria-label={t('switch')}
        onClick={() => setSheet('switch')}
        className="grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1"
      >
        <ArrowLeftRight aria-hidden width={18} height={18} />
      </button>
      <button
        type="button"
        aria-label={tb('end')}
        onClick={() => setSheet('end')}
        className="touch-target on-navy inline-flex h-8.5 flex-none cursor-pointer items-center rounded-full border-0 bg-navy px-3.5 font-sans text-table font-semibold text-on-navy"
      >
        {t('end')}
      </button>
      {sheet === 'switch' && (
        <SwitchSheet grants={grants} now={now} onClose={() => setSheet(null)} />
      )}
      {sheet === 'end' && <EndSessionSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

const ROW =
  'flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left font-sans text-fg-1 no-underline shadow-row-divider last:shadow-none hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-60';

function Initials({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="grid size-8 flex-none place-items-center rounded-sm border border-border bg-bg-base text-micro font-semibold box-border"
    >
      {children}
    </span>
  );
}

function RowText({ title, meta }: { title: string; meta: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col py-2.5 leading-snug">
      <strong className="truncate text-body font-semibold">{title}</strong>
      {meta && <span className="truncate text-meta font-medium text-fg-2">{meta}</span>}
    </span>
  );
}

/**
 * MP11 Skift kunde (P5): active grants open straight away, the rest go to the customer page in
 * Platform ("Anmod" opens MP09 there); Superadmin can also open any customer directly.
 */
function SwitchSheet({
  grants,
  now,
  onClose,
}: {
  grants: SwitcherGrant[];
  now: number;
  onClose: () => void;
}) {
  const t = useTranslations('mobile.supportView');
  const tb = useTranslations('platform.supportBar');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  // One row per customer: the newest grant wins, an active one before anything else.
  const unique = useMemo(() => {
    const seen = new Map<string, SwitcherGrant>();
    for (const g of grants) {
      const prev = seen.get(g.tenantId);
      if (!prev || (g.state === 'active' && prev.state !== 'active')) seen.set(g.tenantId, g);
    }
    return [...seen.values()];
  }, [grants]);
  const list = unique.filter((g) => g.tenantName.toLowerCase().includes(q.trim().toLowerCase()));
  const active = list.filter((g) => g.state === 'active');
  const others = list.filter((g) => g.state !== 'active' && g.state !== 'direct');
  const direct = list.filter((g) => g.state === 'direct');
  const meta = (g: SwitcherGrant) => {
    const ref = g.caseRef ? t('caseRef', { case: g.caseRef }) : '';
    const state =
      g.state === 'expired'
        ? t('expired', { date: formatDate(new Date(g.expiresAt), locale) })
        : g.state === 'denied'
          ? t('denied')
          : g.state === 'ended' || g.state === 'revoked'
            ? t('ended')
            : null;
    return [state, ref].filter(Boolean).join(' · ');
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('switch')} closeLabel={tc('close')}>
      {unique.length > 6 && (
        <MobileField label={<span className="sr-only">{tb('search')}</span>}>
          <MobileInput
            type="search"
            value={q}
            placeholder={tb('search')}
            onChange={(e) => setQ(e.target.value)}
          />
        </MobileField>
      )}
      {active.length > 0 && (
        <>
          <SectionHeading flush>{tb('activeGrants')}</SectionHeading>
          <MobileCard>
            {active.map((g) => (
              <button
                key={g.grantId}
                type="button"
                className={ROW}
                disabled={pending}
                onClick={() => start(async () => void (await openSupportViewAction(g.grantId)))}
              >
                <Initials>{g.initials}</Initials>
                <RowText title={g.tenantName} meta={t('caseRef', { case: g.caseRef })} />
                {/* ok-fg text on ok-bg is 4.4:1: dark words, green clock. */}
                <span className="inline-flex h-6 flex-none items-center gap-1 rounded-full bg-ok-bg px-2 text-micro font-semibold text-fg-1">
                  <Clock aria-hidden width={12} height={12} className="text-ok-fg" />
                  {formatRelative(new Date(g.expiresAt), new Date(now), locale)}
                </span>
              </button>
            ))}
          </MobileCard>
        </>
      )}
      {others.length > 0 && (
        <>
          <SectionHeading flush>{tb('recent')}</SectionHeading>
          <MobileCard>
            {others.map((g) =>
              g.state === 'pending' ? (
                <div key={g.grantId} className={cn(ROW, 'cursor-default hover:bg-transparent')}>
                  <Initials>{g.initials}</Initials>
                  <RowText title={g.tenantName} meta={meta(g)} />
                  <span className="flex-none text-meta font-medium text-fg-2">{tb('pending')}</span>
                </div>
              ) : (
                <Link
                  key={g.grantId}
                  href={`/platform/customers/${g.tenantId}?request=1`}
                  className={ROW}
                  onClick={onClose}
                >
                  <Initials>{g.initials}</Initials>
                  <RowText title={g.tenantName} meta={meta(g)} />
                  <span className="inline-flex h-7 flex-none items-center gap-1 rounded-full bg-white px-3 text-meta font-semibold shadow-ring-strong">
                    <Lock aria-hidden width={12} height={12} />
                    {tb('request')}
                  </span>
                </Link>
              ),
            )}
          </MobileCard>
        </>
      )}
      {direct.length > 0 && (
        <>
          <SectionHeading flush>{tb('allCustomers')}</SectionHeading>
          <MobileCard>
            {direct.map((g) => (
              <button
                key={g.grantId}
                type="button"
                className={ROW}
                disabled={pending}
                onClick={() => start(async () => void (await openAsSuperadminAction(g.tenantId)))}
              >
                <Initials>{g.initials}</Initials>
                <RowText title={g.tenantName} meta="" />
                <span className="flex flex-none items-center gap-1 text-meta font-semibold text-fg-2">
                  <Eye aria-hidden width={14} height={14} />
                  {tb('direct')}
                </span>
              </button>
            ))}
          </MobileCard>
        </>
      )}
      <MobileFootnote>{tb('withoutAccess')}.</MobileFootnote>
    </Modal>
  );
}

/**
 * MP14 Afslut supportsession (S5): the logged time, the session's actions, the case it goes on, a
 * short internal note, and whether the grant ends now. Same action as desktop; it leaves the
 * support view for the case or the customer page.
 */
function EndSessionSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations('mobile.endSession');
  const tb = useTranslations('platform.supportBar');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const now = useNow();
  const [info, setInfo] = useState<SessionEndInfo | null>(null);
  const [error, setError] = useState(false);
  const [caseId, setCaseId] = useState('none');
  const [summary, setSummary] = useState('');
  const [billable, setBillable] = useState(true);
  const [endGrant, setEndGrant] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    void supportSessionInfoAction().then((res) => {
      if (!res.ok) return setError(true);
      setInfo(res.data!);
      setCaseId(res.data!.caseId ?? res.data!.cases[0]?.id ?? 'none');
    });
  }, []);

  const minutes = Math.min(1440, Math.max(1, info?.minutes ?? 1));
  const caseLabel = info?.cases.find((c) => c.id === caseId)?.label.split(' ')[0];
  const time = formatMinutes(minutes, locale);
  const endHelp = info
    ? tb('endGrantHelp', { when: formatRelative(new Date(info.expiresAt), now, locale) })
    : '';
  const endLabel = `${tb('endGrant')} ${endHelp}`;
  const submit = (discard: boolean) =>
    start(async () => {
      const res = await endSupportViewAction({
        minutes,
        caseId: caseId === 'none' ? null : caseId,
        summary,
        billable,
        endGrant,
        discard,
      });
      if (res && !res.ok) setError(true);
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={tb('endTitle')}
      description={
        info
          ? t('when', {
              name: info.tenantName,
              from: formatTime(new Date(info.startedAt), locale),
              to: formatTime(new Date(info.lastActionAt), locale),
            })
          : undefined
      }
      closeLabel={tc('close')}
    >
      {error && (
        <p role="alert" className="m-0 text-table font-medium text-error-fg">
          {tb('error')}
        </p>
      )}
      {!info && !error && <RowsSkeleton rows={3} label={t('loading')} leading="none" />}
      {info && (
        <>
          <MobileCard>
            <div className="flex flex-col gap-1 px-4 py-3.5">
              <strong className="text-m-title">{formatMinutes(info.minutes, locale)}</strong>
              <span className="text-meta font-medium text-fg-2">{tb('autoLogged')}</span>
            </div>
          </MobileCard>
          {info.actions.length > 0 && (
            <ExpandCard
              title={tb('actions', { count: info.actions.length })}
              meta={t('actionsMeta')}
            >
              {info.actions.map((a, i) => (
                <KV
                  key={i}
                  k={<span className="tabular">{formatTime(new Date(a.at), locale)}</span>}
                >
                  {actionLabel(tb, a.label)}
                </KV>
              ))}
            </ExpandCard>
          )}
          <MobileField label={tb('linkCase')}>
            <MobileSelect
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              options={[
                ...info.cases.map((c) => ({ value: c.id, label: c.label })),
                { value: 'none', label: tb('noCase') },
              ]}
            />
          </MobileField>
          <MobileField label={t('summary')}>
            <MobileTextarea
              rows={2}
              maxLength={500}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </MobileField>
          <div className="flex items-center justify-between gap-3">
            <strong className="text-body">{tb('billable')}</strong>
            <Switch checked={billable} onCheckedChange={setBillable} label={tb('billable')} />
          </div>
          <div className="-ml-2.5 flex items-center gap-1 text-table">
            <MobileCheckbox checked={endGrant} onCheckedChange={setEndGrant} label={endLabel} />
            <span aria-hidden>
              {tb('endGrant')} <span className="text-fg-2">{endHelp}</span>
            </span>
          </div>
          <BigButton loading={pending} onClick={() => submit(false)}>
            {caseLabel ? tb('saveOnCase', { time, case: caseLabel }) : tb('save', { time })}
          </BigButton>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={onClose}
              className="touch-target cursor-pointer border-0 bg-transparent p-0 font-sans text-table font-semibold text-fg-1"
            >
              {tb('continue')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit(true)}
              className="touch-target cursor-pointer border-0 bg-transparent p-0 font-sans text-table font-semibold text-fg-1 disabled:opacity-60"
            >
              {tb('discard')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
