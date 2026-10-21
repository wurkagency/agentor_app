import { listCases } from '@agentor/db';
import { formatMinutes, type Locale } from '@agentor/i18n';
import { HeroCurve, KpiCard, MiniBars, SegmentBar } from '@agentor/ui';
import { CircleCheck, Clock, Hourglass, MessageSquare, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { CaseBoard, type BoardCase } from '@/components/platform/case-board';
import { NewCaseButton } from '@/components/platform/new-case-button';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { Responsive } from '@agentor/ui/mobile';
import { CasesMobile, type CaseFilter } from './mobile';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, statsFor, tenantNames } from '@/server/platform-data';

/** Support › Sager (S1): board or list of the cases that aren't archived. */
export async function BoardView({
  view,
  filter = 'mine',
  viewSwitch,
}: {
  view: 'board' | 'list';
  viewSwitch: ReactNode;
  /** Mobile chips (MP02). */
  filter?: CaseFilter;
}) {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.cases');
  const locale = (await getLocale()) as Locale;
  const [names, customers, stats] = await Promise.all([
    tenantNames(actor.userId),
    customersFor(actor.userId),
    statsFor(actor.userId),
  ]);
  const [cases, archived] = await Promise.all([
    listCases(db(), actor.userId, names, { archived: false }),
    listCases(db(), actor.userId, names, { archived: true }),
  ]);
  const failures = new Map(customers.map((c) => [c.tenantId, c.openFailures]));
  const items: BoardCase[] = cases.map((c) => ({
    id: c.id,
    number: c.number,
    title: c.title,
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    tenantInitials: initials(c.tenantName),
    status: c.status,
    priority: c.priority,
    category: c.category,
    assigneeId: c.assigneeId,
    assigneeName: c.assigneeName,
    dueAt: c.dueAt?.toISOString() ?? null,
    updatedAt: c.updatedAt.toISOString(),
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    notes: c.notes,
    minutes: c.minutes,
    errors: failures.get(c.tenantId) ?? 0,
  }));
  const customerList = customers.map((c) => ({ id: c.tenantId, name: c.name }));
  const overdueName = stats.overdueTop ? names.get(stats.overdueTop.tenantId) : null;
  // Open cases at the end of each of the last 8 weeks, and cases resolved per week (README 19).
  const all = [...cases, ...archived];
  const week = 7 * 86_400_000;
  const now = Date.now();
  const openCurve = Array.from({ length: 8 }, (_, i) => {
    const at = now - (7 - i) * week;
    return all.filter(
      (c) => c.createdAt.getTime() <= at && (!c.resolvedAt || c.resolvedAt.getTime() > at),
    ).length;
  });
  const resolvedWeeks = Array.from({ length: 6 }, (_, i) => {
    const end = now - (5 - i) * week;
    return {
      label: String(i),
      value: all.filter(
        (c) => c.resolvedAt && c.resolvedAt.getTime() <= end && c.resolvedAt.getTime() > end - week,
      ).length,
    };
  });

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <>
            <NewCaseButton customers={customerList} />
            {viewSwitch}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-kpi-hero">
        <KpiCard
          compact
          hero
          icon={MessageSquare}
          label={t('statOpen')}
          value={String(stats.open)}
          visual={<HeroCurve compact data={openCurve} />}
          footer={t('statOpenSub', { count: stats.mine })}
        />
        <KpiCard
          compact
          icon={TriangleAlert}
          iconTone={stats.overdue > 0 ? 'error' : 'muted'}
          label={t('statOverdue')}
          value={String(stats.overdue)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: stats.overdue, tone: 'error' },
                { value: Math.max(0, stats.open - stats.overdue), tone: 'muted' },
              ]}
            />
          }
          footer={
            overdueName && stats.overdueTop
              ? `${overdueName} · ${formatMinutes(stats.overdueTop.minutes, locale)}`
              : t('statOverdueNone')
          }
        />
        <KpiCard
          compact
          icon={Hourglass}
          label={t('statWaiting')}
          value={String(stats.waiting)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: stats.waiting, tone: 'hatch' },
                { value: Math.max(0, stats.open - stats.waiting), tone: 'muted' },
              ]}
            />
          }
          footer={
            stats.oldestWaitingDays === null
              ? '–'
              : t('statWaitingSub', { count: stats.oldestWaitingDays })
          }
        />
        <KpiCard
          compact
          icon={CircleCheck}
          label={t('statResolved')}
          value={String(stats.resolvedThisWeek)}
          visual={<MiniBars compact items={resolvedWeeks} />}
          footer={
            stats.medianResolveMinutes === null
              ? '–'
              : t('statResolvedSub', { time: formatMinutes(stats.medianResolveMinutes, locale) })
          }
        />
        <KpiCard
          compact
          icon={Clock}
          label={t('statTime')}
          value={formatMinutes(stats.teamMinutesToday, locale)}
          visual={
            <SegmentBar
              compact
              segments={[
                { value: stats.teamMinutesToday, tone: 'ink' },
                {
                  value: Math.max(0, stats.teamSize * 450 - stats.teamMinutesToday),
                  tone: 'muted',
                },
              ]}
            />
          }
          footer={t('statTimeSub', { count: stats.teamSize })}
        />
      </div>
      <CaseBoard
        cases={items}
        userId={actor.userId}
        customers={customerList}
        view={view}
        archived={archived.length}
      />
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <CasesMobile
          cases={items}
          userId={actor.userId}
          filter={filter}
          minutesToday={stats.minutesToday}
          customers={customerList}
        />
      }
    />
  );
}
