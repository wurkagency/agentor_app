import {
  getTimer,
  listCases,
  myOpenSession,
  timeBetween,
  unconfirmedSessions,
  type CaseRow,
} from '@agentor/db';
import { formatDate, formatHm, formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileCallout,
  MobileCard,
  MobileEmpty,
  MobileShell,
  SectionHeading,
  TrendPill,
} from '@agentor/ui/mobile';
import { Clock, Timer, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';
import {
  EditTimeButton,
  LinkSessionButton,
  LiveClock,
  RegisterTimeFab,
  StopTimerButton,
} from './mobile-time';
import { weekStart } from './view';

const DAY = 86_400_000;
const WEEK_GOAL_MINUTES = 30 * 60;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const noon = (s: string) => new Date(`${s}T12:00:00`);
function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - y.getTime()) / DAY + 1) / 7);
}

function Kpi({
  label,
  value,
  meta,
  pill,
}: {
  label: string;
  value: string;
  meta: string;
  pill?: ReactNode;
}) {
  return (
    <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
      <span className="flex items-center justify-between gap-1.5">
        <span className="truncate text-meta font-medium text-fg-2">{label}</span>
        {pill}
      </span>
      <strong className="text-m-kpi tabular">{value}</strong>
      <span className="truncate text-micro text-fg-2">{meta}</span>
    </MobileCard>
  );
}

/**
 * MP15 Min tid (S6): the running support session or case timer, today's and the week's time,
 * sessions that still need a case, and this week's entries per day with "Ret tid". Time on a
 * timer is rounded up to 15 min. unless overridden (B1).
 */
export async function MyTimeMobile({ week }: { week: string | undefined }) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.time');
  const tm = await getTranslations('mobile.myTime');
  const locale = (await getLocale()) as Locale;
  const parsed = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? noon(week) : new Date();
  const start = weekStart(parsed);
  const end = new Date(start.getTime() + 7 * DAY);
  const today = iso(new Date());
  const [all, names, open, unconfirmed, timer] = await Promise.all([
    // A week back as well, for today's trend on a Monday.
    timeBetween(db(), actor.userId, iso(new Date(start.getTime() - 7 * DAY)), iso(end), true),
    tenantNames(actor.userId),
    myOpenSession(db(), actor.userId),
    unconfirmedSessions(db(), actor.userId),
    getTimer(db(), actor.userId),
  ]);
  const [openCases, closedCases] = await Promise.all([
    listCases(db(), actor.userId, names, { archived: false }),
    listCases(db(), actor.userId, names, {
      archived: true,
      since: new Date(start.getTime() - 7 * DAY),
    }),
  ]);
  const caseById = new Map<string, CaseRow>([...openCases, ...closedCases].map((c) => [c.id, c]));
  const entries = all.filter((e) => e.workDate >= iso(start));
  const sum = (xs: { minutes: number }[]) => xs.reduce((a, e) => a + e.minutes, 0);

  const todayEntries = entries.filter((e) => e.workDate === today);
  const todayMinutes = sum(todayEntries);
  const todayCustomer = sum(todayEntries.filter((e) => e.tenantId));
  const lastDay = [...new Set(all.map((e) => e.workDate))]
    .filter((d) => d < today)
    .sort()
    .pop();
  const lastMinutes = lastDay ? sum(all.filter((e) => e.workDate === lastDay)) : 0;
  const pct =
    lastMinutes && todayMinutes ? Math.round((todayMinutes / lastMinutes - 1) * 100) : null;
  const weekMinutes = sum(entries);

  const days = [...new Set(entries.map((e) => e.workDate))].sort().reverse();
  const dayLabel = (d: string) => {
    const s = noon(d).toLocaleDateString(locale === 'da' ? 'da-DK' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const dayShort = (d: string) => {
    const s = noon(d).toLocaleDateString(locale === 'da' ? 'da-DK' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const pickCases = openCases.map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    label: `#${c.number} ${c.title}`,
    tenantName: c.tenantName,
  }));
  const sessionCase = open?.caseId ? caseById.get(open.caseId) : undefined;
  const timerCase = timer?.caseId ? caseById.get(timer.caseId) : undefined;
  const lastWorkDay = new Date(
    end.getTime() - DAY * (days.some((d) => noon(d).getDay() % 6 === 0) ? 1 : 3),
  );

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/support/cases"
          title={t('title')}
          subtitle={t('weekLabel', {
            n: isoWeek(start),
            from: formatDate(start, locale).replace(/ \d{4}$/, ''),
            to: formatDate(lastWorkDay, locale),
          })}
        />
      }
    >
      {open && (
        <MobileCallout
          tone="lime"
          icon={Clock}
          title={
            <>
              {tm('sessionAt', { name: names.get(open.tenantId) ?? '' })} ·{' '}
              <LiveClock startedAt={open.startedAt.toISOString()} />
            </>
          }
          actions={
            <CardButton href="/" linkAs={Link} variant="dark">
              {t('endAndSave')}
            </CardButton>
          }
        >
          {sessionCase ? tm('sessionCase', { n: sessionCase.number }) : t('sessionRunningSub')}
        </MobileCallout>
      )}
      {timer && (
        <MobileCallout
          tone="lime"
          icon={Timer}
          title={
            <>
              {timerCase ? tm('timerOn', { n: timerCase.number }) : tm('timerNoCase')} ·{' '}
              <LiveClock startedAt={timer.startedAt.toISOString()} />
            </>
          }
          actions={
            <StopTimerButton
              startedAt={timer.startedAt.toISOString()}
              caseLabel={timerCase ? `#${timerCase.number} · ${timerCase.tenantName}` : t('noCase')}
              hasCustomer={Boolean(timerCase)}
            />
          }
        >
          {timerCase ? timerCase.title : tm('timerRounding')}
        </MobileCallout>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi
          label={tm('today')}
          value={formatMinutes(todayMinutes, locale)}
          meta={t('statTodaySub', {
            pct: todayMinutes ? Math.round((todayCustomer / todayMinutes) * 100) : 0,
          })}
          {...(pct !== null && lastDay
            ? {
                pill: (
                  <TrendPill
                    growth={{
                      direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
                      tone: pct > 0 ? 'good' : 'neutral',
                      text: `${Math.abs(pct)} %`,
                      label: tm('trend', { pct, day: dayShort(lastDay) }),
                    }}
                  />
                ),
              }
            : {})}
        />
        <Kpi
          label={t('statWeek')}
          value={formatMinutes(weekMinutes, locale)}
          meta={tm('goal', { goal: formatMinutes(WEEK_GOAL_MINUTES, locale) })}
        />
      </div>
      {unconfirmed.map((s) => {
        const from = new Date(s.started_at);
        const to = new Date(s.last_action_at);
        return (
          <MobileCallout
            key={s.id}
            tone="warn"
            icon={TriangleAlert}
            title={tm('unlinked')}
            actions={
              <LinkSessionButton
                sessionId={s.id}
                cases={pickCases
                  .filter((c) => c.tenantId === s.tenant_id)
                  .map(({ id, label }) => ({ id, label }))}
              />
            }
          >
            {[
              names.get(s.tenant_id) ?? '',
              `${formatDate(from, locale).replace(/ \d{4}$/, '')} ${formatTime(from, locale)}–${formatTime(to, locale)}`,
              formatMinutes(Number(s.minutes), locale),
            ].join(' · ')}
          </MobileCallout>
        );
      })}
      {days.length === 0 ? (
        <MobileEmpty icon={Clock} title={t('empty')}>
          {t('intro')}
        </MobileEmpty>
      ) : (
        days.map((d) => {
          const list = entries.filter((e) => e.workDate === d);
          return (
            <section key={d} className="flex flex-col gap-3" aria-label={dayLabel(d)}>
              <div className="mx-1 mt-3.5 flex items-baseline justify-between gap-3">
                <SectionHeading flush>{dayLabel(d)}</SectionHeading>
                <span className="text-meta font-medium text-fg-2">
                  {tm('dayTotal', { time: formatHm(sum(list)) })}
                </span>
              </div>
              {list.map((e) => {
                const c = e.caseId ? caseById.get(e.caseId) : undefined;
                const tenant = e.tenantId ? (names.get(e.tenantId) ?? '') : '';
                const what = e.description || t(`kind.${e.kind}`);
                return (
                  <ExpandCard
                    key={e.id}
                    leading={
                      <span className="w-11 flex-none font-mono text-micro text-fg-2">
                        {c ? `#${c.number}` : '–'}
                      </span>
                    }
                    title={c ? c.title : what}
                    meta={tenant || t('noCase')}
                    trailing={<strong className="text-body tabular">{formatHm(e.minutes)}</strong>}
                  >
                    <KV k={tm('customer')}>{tenant || t('noCase')}</KV>
                    <KV k={t('type')}>{t(`kind.${e.kind}`)}</KV>
                    {c && e.description && <KV k={t('description')}>{e.description}</KV>}
                    <KV k={t('colSource')}>
                      {e.source === 'auto'
                        ? t('sourceAuto', { time: formatMinutes(e.minutes, locale) })
                        : e.source === 'timer'
                          ? tm('sourceTimer')
                          : t('sourceManual')}
                    </KV>
                    {e.tenantId && <KV k={t('billable')}>{e.billable ? tm('yes') : tm('no')}</KV>}
                    <KV k={dayShort(d)}>{formatHm(e.minutes)}</KV>
                    {e.invoiced ? (
                      <p className="m-0 pt-2 text-meta font-medium text-fg-2">{tm('invoiced')}</p>
                    ) : (
                      <CardActions>
                        <EditTimeButton
                          entry={{
                            id: e.id,
                            minutes: e.minutes,
                            kind: e.kind,
                            description: e.description,
                            billable: e.billable,
                            hasCustomer: e.tenantId !== null,
                            label: c ? `#${c.number} · ${tenant}` : what,
                          }}
                        />
                      </CardActions>
                    )}
                  </ExpandCard>
                );
              })}
            </section>
          );
        })
      )}
      {/* Room for the floating "Registrér tid" over the last row. */}
      <div aria-hidden className="h-16 flex-none" />
      <RegisterTimeFab cases={pickCases.map(({ id, label }) => ({ id, label }))} />
    </MobileShell>
  );
}
