import { listCases } from '@agentor/db';
import { formatMinutes, type Locale } from '@agentor/i18n';
import { StatCard } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { CaseBoard, type BoardCase } from '@/components/platform/case-board';
import { NewCaseButton } from '@/components/platform/new-case-button';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { customersFor, initials, statsFor, tenantNames } from '@/server/platform-data';

/** Supportsager (S1): board or list of the cases that aren't archived. */
export async function BoardView({ view }: { view: 'board' | 'list' }) {
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

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={<NewCaseButton customers={customerList} />}
      />
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t('statOpen')} value={String(stats.open)} footer={t('statOpenSub', { count: stats.mine })} />
        <StatCard
          label={t('statOverdue')}
          value={String(stats.overdue)}
          footer={
            overdueName && stats.overdueTop
              ? `${overdueName} · ${formatMinutes(stats.overdueTop.minutes, locale)}`
              : t('statOverdueNone')
          }
          {...(stats.overdue > 0 ? { className: 'bg-error-bg' } : {})}
        />
        <StatCard
          label={t('statWaiting')}
          value={String(stats.waiting)}
          footer={stats.oldestWaitingDays === null ? '–' : t('statWaitingSub', { count: stats.oldestWaitingDays })}
        />
        <StatCard
          label={t('statResolved')}
          value={String(stats.resolvedThisWeek)}
          footer={
            stats.medianResolveMinutes === null
              ? '–'
              : t('statResolvedSub', { time: formatMinutes(stats.medianResolveMinutes, locale) })
          }
        />
        <StatCard
          label={t('statTime')}
          value={formatMinutes(stats.teamMinutesToday, locale)}
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
}
