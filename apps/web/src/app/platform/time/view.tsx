import {
  listCases,
  myOpenSession,
  timeBetween,
  unconfirmedSessions,
  type TimeEntryRow,
} from '@agentor/db';
import { formatDate, formatHm, formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import { Card, HeroCurve, Icon, KpiCard, SegmentBar, Table, Td, Th, Tr, cn } from '@agentor/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock,
  Download,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { LinkSessionButton, RegisterTimeButton } from '@/components/platform/time-actions';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';

/** Monday of the ISO week containing d (local time). */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - y.getTime()) / 86_400_000 + 1) / 7);
}

const WEEK_GOAL_MINUTES = 30 * 60;

/** Min tid / Teamet (S6): time per case and day for a week. */
export async function TimeView({ team, week }: { team: boolean; week: string | undefined }) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.time');
  const locale = (await getLocale()) as Locale;
  const parsed =
    week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T12:00:00`) : new Date();
  const start = weekStart(parsed);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const today = iso(new Date());
  const [entries, names, open, unconfirmed] = await Promise.all([
    timeBetween(db(), actor.userId, iso(start), iso(end), !team),
    tenantNames(actor.userId),
    myOpenSession(db(), actor.userId),
    unconfirmedSessions(db(), actor.userId),
  ]);
  const cases = await listCases(db(), actor.userId, names, { archived: false });
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const days = Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * 86_400_000)));
  const showWeekend = entries.some((e) => e.workDate === days[5] || e.workDate === days[6]);
  const cols = showWeekend ? days : days.slice(0, 5);

  type Row = {
    key: string;
    title: string;
    sub: string;
    caseNumber: number | null;
    perDay: Map<string, number>;
    auto: number;
    manual: number;
  };
  const rows = new Map<string, Row>();
  const add = (e: TimeEntryRow) => {
    const c = e.caseId ? caseById.get(e.caseId) : null;
    const key = e.caseId ?? `none:${e.description || e.kind}`;
    const row =
      rows.get(key) ??
      ({
        key,
        title: c ? (names.get(c.tenantId) ?? '') : t('noCase'),
        sub: c ? c.title : e.description || t(`kind.${e.kind}`),
        caseNumber: c?.number ?? null,
        perDay: new Map(),
        auto: 0,
        manual: 0,
      } satisfies Row);
    row.perDay.set(e.workDate, (row.perDay.get(e.workDate) ?? 0) + e.minutes);
    if (e.source === 'auto') row.auto += e.minutes;
    else row.manual += e.minutes;
    rows.set(key, row);
  };
  entries.forEach(add);
  const list = [...rows.values()].sort((a, b) => (a.caseNumber ?? 1e9) - (b.caseNumber ?? 1e9));
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const mine = entries.filter((e) => e.staffUserId === actor.userId);
  const todayMine = mine.filter((e) => e.workDate === today);
  const todayMinutes = todayMine.reduce((a, e) => a + e.minutes, 0);
  const todayCustomer = todayMine.filter((e) => e.tenantId).reduce((a, e) => a + e.minutes, 0);
  const autoMine = mine.filter((e) => e.source === 'auto');
  const prev = iso(new Date(start.getTime() - 7 * 86_400_000));
  const next = iso(end);
  const base = team ? '/platform/time/team' : '/platform/time';
  const openCases = cases
    .filter((c) => c.status !== 'resolved' && c.status !== 'closed')
    .map((c) => ({ id: c.id, tenantId: c.tenantId, label: `#${c.number} ${c.title}` }));

  return (
    <PageBody>
      <PageHeader
        title={team ? t('teamTitle') : t('title')}
        subtitle={t('intro')}
        actions={
          <>
            <ButtonLink
              variant="secondary"
              href={`/platform/time/export?week=${iso(start)}${team ? '&team=1' : ''}`}
            >
              <Icon icon={Download} size={16} />
              {t('export')}
            </ButtonLink>
            <RegisterTimeButton />
          </>
        }
      />
      {open && (
        <div className="on-navy flex flex-wrap items-center justify-between gap-3 rounded-md bg-navy px-5 py-4 text-on-navy">
          <span className="flex items-center gap-3">
            <Icon icon={Clock} size={24} />
            <span className="flex flex-col">
              <strong>
                {t('sessionRunning', {
                  name: names.get(open.tenantId) ?? '',
                  time: formatTime(open.startedAt, locale),
                })}
              </strong>
              <span className="text-meta text-on-navy-muted">{t('sessionRunningSub')}</span>
            </span>
          </span>
          <ButtonLink variant="primary" size="s" href="/">
            {t('endAndSave')}
          </ButtonLink>
        </div>
      )}
      {!team && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
          <KpiCard
            compact
            hero
            icon={Clock}
            label={t('statToday')}
            value={formatMinutes(todayMinutes, locale)}
            visual={
              <HeroCurve
                compact
                data={days.map((d) =>
                  entries
                    .filter((e) => e.workDate === d && e.staffUserId === actor.userId)
                    .reduce((a, e) => a + e.minutes, 0),
                )}
              />
            }
            footer={t('statTodaySub', {
              pct: todayMinutes ? Math.round((todayCustomer / todayMinutes) * 100) : 0,
            })}
          />
          <KpiCard
            compact
            icon={CalendarDays}
            label={t('statWeek')}
            value={formatMinutes(total, locale)}
            visual={
              <SegmentBar
                compact
                segments={[
                  { value: total, tone: 'ink' },
                  { value: Math.max(0, WEEK_GOAL_MINUTES - total), tone: 'muted' },
                ]}
              />
            }
            footer={t('statWeekSub', { goal: formatMinutes(WEEK_GOAL_MINUTES, locale) })}
          />
          <KpiCard
            compact
            icon={Zap}
            label={t('statAuto')}
            value={formatMinutes(
              autoMine.reduce((a, e) => a + e.minutes, 0),
              locale,
            )}
            visual={
              <SegmentBar
                compact
                segments={[
                  { value: autoMine.reduce((a, e) => a + e.minutes, 0), tone: 'hatch' },
                  {
                    value: Math.max(0, total - autoMine.reduce((a, e) => a + e.minutes, 0)),
                    tone: 'ink',
                  },
                ]}
              />
            }
            footer={t('statAutoSub', { count: autoMine.length })}
          />
          <KpiCard
            compact
            icon={TriangleAlert}
            iconTone={unconfirmed.length ? 'error' : 'muted'}
            label={t('statReview')}
            value={String(unconfirmed.length)}
            visual={
              <SegmentBar
                compact
                segments={[
                  { value: unconfirmed.length, tone: 'warn' },
                  { value: autoMine.length, tone: 'ink' },
                ]}
              />
            }
            footer={unconfirmed.length ? t('statReviewSub') : t('statReviewNone')}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Link
            href={`${base}?week=${prev}`}
            aria-label={t('prevWeek')}
            className="grid size-9 place-items-center rounded-full text-fg-1 hover:bg-surface"
          >
            <Icon icon={ArrowLeft} size={16} />
          </Link>
          <strong className="text-body">
            {t('weekLabel', {
              n: isoWeek(start),
              from: formatDate(start, locale).replace(/ \d{4}$/, ''),
              to: formatDate(new Date(end.getTime() - 86_400_000 * (showWeekend ? 1 : 3)), locale),
            })}
          </strong>
          <Link
            href={`${base}?week=${next}`}
            aria-label={t('nextWeek')}
            className="grid size-9 place-items-center rounded-full text-fg-1 hover:bg-surface"
          >
            <Icon icon={ArrowRight} size={16} />
          </Link>
        </span>
        <nav
          aria-label={t('scope')}
          className="flex items-center gap-1 rounded-full bg-surface p-1 shadow-sm"
        >
          {[
            { href: `/platform/time?week=${iso(start)}`, label: t('me'), on: !team },
            { href: `/platform/time/team?week=${iso(start)}`, label: t('team'), on: team },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.on ? 'page' : undefined}
              className={cn(
                'rounded-full px-4 py-1.5 text-table font-semibold no-underline',
                l.on ? 'bg-fg-1 text-white' : 'text-fg-2',
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <Card padding="none" className="overflow-x-auto">
        <Table aria-label={t('grid')}>
          <thead>
            <tr>
              <Th className="pl-5">{t('colCase')}</Th>
              {cols.map((d) => (
                <Th key={d} numeric>
                  {new Date(`${d}T12:00:00`).toLocaleDateString(
                    locale === 'da' ? 'da-DK' : 'en-GB',
                    { weekday: 'short', day: 'numeric' },
                  )}
                </Th>
              ))}
              <Th numeric>{t('colTotal')}</Th>
              <Th className="pr-5">{t('colSource')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <Tr>
                <Td colSpan={cols.length + 3} className="pl-5 text-fg-2">
                  {t('empty')}
                </Td>
              </Tr>
            )}
            {list.map((r) => {
              const sum = [...r.perDay.values()].reduce((a, b) => a + b, 0);
              return (
                <Tr key={r.key}>
                  <Td className="pl-5">
                    <span className="flex flex-col leading-tight">
                      <span>
                        {r.caseNumber !== null && (
                          <span className="font-mono text-mono text-fg-2">#{r.caseNumber} </span>
                        )}
                        <strong>{r.title}</strong>
                      </span>
                      <span className="text-meta text-fg-2">{r.sub}</span>
                    </span>
                  </Td>
                  {cols.map((d) => (
                    <Td key={d} numeric className={cn(!r.perDay.get(d) && 'text-fg-2')}>
                      {r.perDay.get(d) ? formatHm(r.perDay.get(d)!) : '–'}
                    </Td>
                  ))}
                  <Td numeric className="font-semibold">
                    {formatHm(sum)}
                  </Td>
                  <Td className="pr-5 text-meta text-fg-2">
                    {r.auto > 0
                      ? t('sourceAuto', { time: formatMinutes(r.auto, locale) })
                      : t('sourceManual')}
                  </Td>
                </Tr>
              );
            })}
            {list.length > 0 && (
              <Tr className="bg-bg-base font-semibold">
                <Td className="pl-5">{t('colTotal')}</Td>
                {cols.map((d) => {
                  const m = entries
                    .filter((e) => e.workDate === d)
                    .reduce((a, e) => a + e.minutes, 0);
                  return (
                    <Td key={d} numeric>
                      {m ? formatHm(m) : '–'}
                    </Td>
                  );
                })}
                <Td numeric>{formatHm(total)}</Td>
                <Td className="pr-5" />
              </Tr>
            )}
          </tbody>
        </Table>
      </Card>
      {!team &&
        unconfirmed.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-bg px-5 py-3 text-table"
          >
            <span className="flex items-center gap-2">
              <Icon icon={TriangleAlert} size={16} className="text-warn-fg" />
              <span>
                <strong>{t('unlinked')}</strong>{' '}
                {t('unlinkedDetail', {
                  time: formatMinutes(Number(s.minutes), locale),
                  name: names.get(s.tenant_id) ?? '',
                  when: `${formatDate(new Date(s.started_at), locale)} ${formatTime(new Date(s.started_at), locale)}–${formatTime(new Date(s.last_action_at), locale)}`,
                })}
              </span>
            </span>
            <LinkSessionButton
              sessionId={s.id}
              cases={openCases
                .filter((c) => c.tenantId === s.tenant_id)
                .map(({ id, label }) => ({ id, label }))}
            />
          </div>
        ))}
    </PageBody>
  );
}
