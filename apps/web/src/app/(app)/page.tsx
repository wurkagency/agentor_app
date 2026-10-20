import { manifestFor } from '@agentor/connectors';
import {
  dailyNumbers,
  getCompany,
  openFailures,
  overviewNumbers,
  recentActivity,
} from '@agentor/db';
import { formatDate, formatNumber, formatPercent, formatTime } from '@agentor/i18n';
import {
  Card,
  CardHeader,
  cn,
  Icon,
  StatCard,
  StatusPill,
  STATUS_STYLE,
  UsageMeter,
} from '@agentor/ui';
import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { explain } from '@/components/flows/record-error';
import { routeTarget } from '@/components/flows/helpers';
import { PageBody, PageHeader, SecondaryBar } from '@/components/shell/secondary-nav';
import { TransactionMeter } from '@/components/shell/transaction-meter';
import { requireAppContext } from '@/server/auth/session';
import { ensureSignupReceipt } from '@/server/signup-receipt';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, NEEDS_ACTION, PERIOD_DAYS, periodOf, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { formatRelative } from '@agentor/i18n';
import { Responsive } from '@agentor/ui/mobile';
import { NewCustomer } from './new-customer';
import { OverviewMobile, type OverviewMobileProps } from './overview-mobile';
import { OnboardingReminder } from '@/components/signup/onboarding-reminder';
import { PeriodSelector } from './period-selector';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('overview') };
}

function greetingKey(now: Date) {
  const h = Number(
    new Intl.DateTimeFormat('da-DK', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Europe/Copenhagen',
    }).format(now),
  );
  return h < 10 ? 'greetingMorning' : h < 18 ? 'greetingDay' : 'greetingEvening';
}

const TILES = ['ok', 'warn', 'error', 'broken', 'paused'] as const;

/** Overblik (D1): is everything running, what needs me, what happened, what does it cost. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireAppContext();
  // Backup for the receipt when SU6 was never opened (Q20); a no-op once it is sent.
  if (!ctx.support)
    await ensureSignupReceipt(
      { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
      ctx.user.email,
    );
  const period = periodOf((await searchParams).period);
  const days = PERIOD_DAYS[period];
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const t = await getTranslations('overview');
  const tp = await getTranslations('pages');
  const ts = await getTranslations('status');
  const te = await getTranslations('recordErrors');
  const nav = await getTranslations('nav');
  const tm = await getTranslations('mobile.overview');
  const locale = (await getLocale()) as 'da' | 'en';
  const now = new Date();
  const firstName = ctx.user.name.split(' ')[0] ?? ctx.user.name;
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);

  const [views, conns, billing, company] = await Promise.all([
    viewsFor(ctx, days),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    billingOverview(ctx),
    getCompany(db(), c),
  ]);
  const published = views.filter((v) => v.published);

  const header = (
    <SecondaryBar label={nav('secondary')} right={<TransactionMeter />}>
      <PeriodSelector />
    </SecondaryBar>
  );

  if (published.length === 0)
    return (
      <>
        {header}
        <OnboardingReminder ctx={ctx} />
        <NewCustomer
          ctx={ctx}
          firstName={firstName}
          company={company}
          planName={billing?.plan.name ?? ''}
          connections={[...conns.values()]}
          hasFlows={views.length > 0}
          firstFlowId={views[0]?.id ?? null}
        />
      </>
    );

  const [numbers, daily, activity, failures] = await Promise.all([
    overviewNumbers(db(), c, days),
    // Eight days: mobile compares today with the same weekday last week (MA02).
    dailyNumbers(db(), c, Math.max(days, 8)),
    recentActivity(db(), c, 8),
    openFailures(db(), c),
  ]);

  const counts = Object.fromEntries(
    TILES.map((s) => [s, views.filter((v) => v.status === s).length]),
  );
  const needing = views.filter((v) => NEEDS_ACTION.includes(v.status));
  const earliest = needing
    .map((v) => v.statusSince)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  // Kræver handling: broken connections first, then failure groups per flow, route and cause.
  const issues: {
    key: string;
    status: 'broken' | 'error';
    title: string;
    body: string;
    meta: string;
    action: { label: string; href: string } | null;
    /** Mobile (MA03): reconnect in the app, or the run's failure screen (MA06). */
    mobile: { title: string; meta: string; href: string; action?: string };
  }[] = [];
  for (const conn of conns.values())
    if (conn.status === 'broken') {
      const affected = views.filter(
        (v) => v.published && [v.source, ...v.destinations].some((x) => x?.id === conn.id),
      );
      issues.push({
        key: conn.id,
        status: 'broken',
        title: t('issue.broken', { name: manifestFor(conn.connectorId)?.name ?? conn.name }),
        body: conn.brokenSince
          ? t('issue.brokenSince', {
              when: `${formatRelativeDay(conn.brokenSince, now, locale)} kl. ${formatTime(conn.brokenSince, locale)}`,
            })
          : '',
        meta: affected.map((v) => `${v.name} · ${t('notRunning')}`).join(', '),
        action: canEdit
          ? { label: t('reconnect'), href: `/connections/${conn.id}?reconnect=1` }
          : null,
        mobile: {
          title: t('issue.broken', { name: manifestFor(conn.connectorId)?.name ?? conn.name }),
          meta: tm('brokenMeta', {
            flow: affected.map((v) => v.name).join(', ') || conn.name,
            when: conn.brokenSince ? relativeWhen(conn.brokenSince) : '–',
          }),
          href: `/connections/${conn.id}/reconnect`,
          ...(canEdit ? { action: tm('reconnect') } : {}),
        },
      });
    }
  const groups = new Map<string, typeof failures>();
  for (const f of failures) {
    const k = `${f.flowId}:${f.routeId}:${f.errorCode}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const [key, rows] of groups) {
    const first = rows[0]!;
    const view = views.find((v) => v.id === first.flowId);
    if (!view) continue;
    const target = routeTarget(view.definition, conns, first.routeId);
    const count = new Set(rows.map((r) => r.sourceId)).size;
    const e = explain((k, p) => te(k, p), {
      errorCode: first.errorCode,
      errorParams: first.errorParams,
      label: first.label,
      entity: first.entity,
      system: target.system,
      fieldLabel: target.fieldLabel(first.errorParams?.field),
    });
    issues.push({
      key,
      status: 'error',
      title: te(
        `notDone.${first.entity === 'creditNote' ? 'creditNote' : first.entity === 'order' ? 'order' : 'record'}`,
        {
          count,
          system: target.system,
        },
      ),
      body: e.short,
      meta: `${view.name} · ${formatTime(first.createdAt, locale)}`,
      mobile: {
        title: te(
          `notDone.${first.entity === 'creditNote' ? 'creditNote' : first.entity === 'order' ? 'order' : 'record'}`,
          { count, system: target.system },
        ),
        meta: `${view.name} · ${formatTime(first.createdAt, locale)}`,
        href: `/integrations/${view.id}/runs/${first.runId}`,
      },
      action: canEdit
        ? e.mappingField
          ? {
              label: t('fixAccount'),
              href: `/integrations/${view.id}/editor?route=${first.routeId}&tab=mapping&field=${encodeURIComponent(e.mappingField)}`,
            }
          : { label: t('seeErrors'), href: `/integrations/${view.id}?tab=runs&run=${first.runId}` }
        : null,
    });
  }

  const trend = (cur: number, prev: number, kind: 'pct' | 'points' = 'pct') => {
    if (kind === 'points') {
      const d = (cur - prev) * 100;
      return {
        direction: d > 0.05 ? ('up' as const) : d < -0.05 ? ('down' as const) : ('flat' as const),
        text: t('points', { value: formatNumber(Math.abs(d), locale, 1) }),
      };
    }
    if (prev === 0) return undefined;
    const r = (cur - prev) / prev;
    return {
      direction: r > 0.005 ? ('up' as const) : r < -0.005 ? ('down' as const) : ('flat' as const),
      text: formatPercent(Math.abs(r), locale, 0),
    };
  };
  const cur = numbers.current;
  const prev = numbers.previous;
  const nameOf = (flowId: string) => views.find((v) => v.id === flowId)?.name ?? '';
  const routeOf = (flowId: string, routeId: string) => {
    const r = views.find((v) => v.id === flowId)?.routes.find((x) => x.id === routeId);
    return r
      ? `${r.source} → ${r.destination.split(' ').slice(1).join(' ') || r.destination}`
      : routeId;
  };
  const setsLimit = billing?.plan.entitlements.integrationSets ?? null;

  const desktop = (
    <>
      {header}
      <OnboardingReminder ctx={ctx} />
      <PageBody>
        <PageHeader
          title={
            ctx.support
              ? tp('supportOverview', { company: ctx.tenant.tenantName })
              : tp(greetingKey(now), { name: firstName })
          }
          subtitle={t('subtitle', {
            company: ctx.tenant.tenantName,
            period: t(`period.${period}`),
          })}
          actions={
            <>
              <ButtonLink variant="secondary" href="/activity">
                {t('seeActivity')}
              </ButtonLink>
              {canEdit && (
                <ButtonLink variant="primary" size="l" href="/integrations/new">
                  <Icon icon={Plus} size={18} />
                  {t('newFlow')}
                </ButtonLink>
              )}
            </>
          }
        />

        <section
          aria-label={t('statusLabel')}
          className="grid gap-3 rounded-md bg-surface p-4 shadow-sm lg:grid-cols-12"
        >
          <div className="flex items-center gap-4 lg:col-span-4 lg:pr-4 lg:shadow-hairline-r">
            <span
              className={cn(
                'grid size-14 flex-none place-items-center rounded-full',
                needing.length ? 'bg-error-bg' : 'bg-ok-bg',
              )}
            >
              <Icon
                icon={STATUS_STYLE[needing.length ? 'error' : 'ok'].icon}
                size={24}
                className={needing.length ? 'text-error-fg' : 'text-ok-fg'}
              />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-card">
                {needing.length ? t('needsAction', { count: needing.length }) : t('allRunning')}
              </h2>
              <p className="m-0 text-meta text-fg-2">
                {needing.length
                  ? [
                      ...(counts.error ? [t('withErrors', { count: counts.error })] : []),
                      ...(counts.broken ? [t('brokenConnections', { count: counts.broken })] : []),
                      ...(counts.warn ? [t('withWarnings', { count: counts.warn })] : []),
                      ...(earliest ? [t('since', { time: formatTime(earliest, locale) })] : []),
                    ].join(' · ')
                  : t('nothingNeeded', { count: views.length })}
              </p>
            </div>
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-5 lg:col-span-8">
            {TILES.map((s) => (
              <li key={s}>
                <Link
                  href={`/integrations`}
                  className={cn(
                    'flex h-full flex-col gap-1 rounded-sm p-4 text-fg-1 no-underline',
                    counts[s] && (s === 'error' || s === 'broken')
                      ? 'bg-error-bg'
                      : 'hover:bg-bg-base',
                  )}
                >
                  <span className="text-stat-compact font-semibold tabular">{counts[s]}</span>
                  <StatusPill status={s} compact className="text-fg-1">
                    {ts(s)}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            variant="lime"
            label={t('kpi.revenue')}
            tooltip={t('kpi.revenueTip')}
            value={formatNumber(Math.round(cur.revenueOre / 100), locale)}
            unit="kr."
            {...withTrend(
              trend(cur.revenueOre, prev.revenueOre),
              t('kpi.vsPrevious', { period: t(`period.${period}`) }),
            )}
            sparkline={daily.map((d) => d.revenueOre)}
          />
          <StatCard
            label={t('kpi.orders')}
            value={formatNumber(cur.orders, locale)}
            {...withTrend(trend(cur.orders, prev.orders))}
            sparkline={daily.map((d) => d.orders)}
          />
          <StatCard
            label={t('kpi.records')}
            value={formatNumber(cur.records, locale)}
            {...withTrend(trend(cur.records, prev.records))}
            sparkline={daily.map((d) => d.records)}
          />
          <StatCard
            label={t('kpi.errorRate')}
            value={formatNumber(cur.errorRate * 100, locale, 1)}
            unit="%"
            {...withTrend(trend(cur.errorRate, prev.errorRate, 'points'))}
            sparkline={daily.map((d) => d.errorRate)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="flex flex-col gap-3 lg:col-span-4" aria-labelledby="needs-action">
            <div className="flex items-baseline justify-between">
              <h2 id="needs-action" className="m-0 text-card">
                {t('needsActionTitle')}
              </h2>
              {issues.length > 0 && <span className="text-meta text-fg-2">{issues.length}</span>}
            </div>
            {issues.length === 0 ? (
              <div className="flex flex-col gap-1 py-4">
                <p className="m-0 text-body font-semibold">{t('nothingTitle')}</p>
                <p className="m-0 text-table text-fg-2">{t('nothingBody')}</p>
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {issues.map((i) => (
                  <li
                    key={i.key}
                    className="flex items-start gap-3 border-t border-border py-3 first:border-0"
                  >
                    <Icon
                      icon={STATUS_STYLE[i.status].icon}
                      size={16}
                      className="mt-0.5 text-error-fg"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="m-0 text-table font-semibold">{i.title}</p>
                      {i.body && <p className="m-0 text-table">{i.body}</p>}
                      <p className="m-0 text-meta text-fg-2">{i.meta}</p>
                    </div>
                    {i.action && (
                      <ButtonLink
                        variant={
                          i.status === 'broken'
                            ? 'dark'
                            : i.action.label === t('fixAccount')
                              ? 'primary'
                              : 'secondary'
                        }
                        size="s"
                        href={i.action.href}
                      >
                        {i.action.label}
                      </ButtonLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="none" className="flex flex-col lg:col-span-5" aria-labelledby="recent">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
              <h2 id="recent" className="m-0 text-card">
                {t('recent')}
              </h2>
              <Link href="/activity" className="text-meta font-semibold text-fg-1">
                {t('seeAllRuns')}
              </Link>
            </div>
            <table className="w-full border-collapse text-table">
              <thead>
                <tr className="text-left text-meta text-fg-1">
                  <th className="px-5 py-2 font-semibold">{t('col.time')}</th>
                  <th className="py-2 font-semibold">{t('col.flowRoute')}</th>
                  <th className="py-2 text-right font-semibold">{t('col.records')}</th>
                  <th className="px-5 py-2 font-semibold">{t('col.outcome')}</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={`${a.runId}-${a.routeId}`} className="border-t border-border">
                    <td className="px-5 py-2 tabular text-fg-2">{formatTime(a.at, locale)}</td>
                    <td className="max-w-0 truncate py-2">
                      {nameOf(a.flowId)} · {routeOf(a.flowId, a.routeId)}
                    </td>
                    <td className="py-2 text-right tabular">{a.records}</td>
                    <td className="px-5 py-2">
                      <StatusPill
                        status={a.failed ? 'error' : a.mode === 'test' ? 'info' : 'ok'}
                        compact
                      >
                        {a.failed
                          ? t('failedCount', { count: a.failed })
                          : a.mode === 'test'
                            ? ts('info')
                            : 'OK'}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="flex flex-col gap-5 lg:col-span-3" aria-labelledby="usage">
            <CardHeader title={t('usage')} />
            {billing && (
              <>
                <div className="flex flex-col gap-1.5">
                  <UsageMeter
                    label={t('transactions')}
                    used={billing.quota.used}
                    limit={billing.quota.limit}
                    valueText={`${formatNumber(billing.quota.used, locale)} / ${billing.quota.limit === null ? t('unlimited') : formatNumber(billing.quota.limit, locale)}`}
                  />
                  <p className="m-0 text-meta text-fg-2">
                    {t('resets', {
                      pct: formatPercent(billing.quota.ratio, locale, 0),
                      date: billing.subscription.currentPeriodEnd
                        ? formatDate(billing.subscription.currentPeriodEnd, locale)
                        : '–',
                    })}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <UsageMeter
                    label={t('integrationSets')}
                    used={billing.usage.integrationSets}
                    limit={setsLimit}
                    valueText={`${billing.usage.integrationSets} / ${setsLimit === null ? t('unlimited') : setsLimit}`}
                  />
                  <p className="m-0 text-meta text-fg-2">
                    {setsLimit === null
                      ? t('noLimit', { plan: billing.plan.name })
                      : t('limitOf', { plan: billing.plan.name, count: setsLimit })}
                  </p>
                </div>
                <div className="mt-auto flex items-baseline justify-between shadow-hairline-t pt-3 text-table">
                  <span>
                    <span className="font-semibold">{billing.plan.name}</span> ·{' '}
                    {t('perMonth', {
                      price: formatNumber(Math.round(billing.plan.priceMonthlyOre / 100), locale),
                    })}
                  </span>
                  {ctx.tenant.role === 'owner' && (
                    <Link href="/billing" className="font-semibold text-fg-1">
                      {t('subscription')}
                    </Link>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  );
  return <Responsive desktop={desktop} mobile={<OverviewMobile {...buildMobile()} />} />;

  /** MA02 / MA03 from the same data as the desktop page. */
  function buildMobile(): OverviewMobileProps {
    const tz = 'Europe/Copenhagen';
    const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const weekAgoDate = new Date(now.getTime() - 7 * 86_400_000);
    const today = byDay.get(dayKey(now));
    const weekAgo = byDay.get(dayKey(weekAgoDate));
    const weekday = (d: Date, style: 'short' | 'long') =>
      new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
        weekday: style,
        timeZone: tz,
      }).format(d);
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * 86_400_000);
      const n = byDay.get(dayKey(d));
      const label = i === 6 ? tm('today') : weekday(d, 'short');
      return {
        label,
        records: n?.records ?? 0,
        errors: n?.failed ?? 0,
        today: i === 6,
        description: tm('weekDay', {
          day: label,
          records: formatNumber(n?.records ?? 0, locale),
          errors: n?.failed ?? 0,
        }),
      };
    });
    const errorsToday = today?.failed ?? 0;
    const lastRun = views
      .map((v) => v.lastRunAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const problems = issues.length > 0;
    const prevRecords = weekAgo?.records ?? 0;
    const change = prevRecords ? ((today?.records ?? 0) - prevRecords) / prevRecords : null;
    const kpiTrend =
      problems && errorsToday
        ? {
            direction: 'up' as const,
            text: tm('errorsUp', { count: errorsToday }),
            tone: 'bad' as const,
          }
        : change === null
          ? undefined
          : {
              direction:
                change > 0.005
                  ? ('up' as const)
                  : change < -0.005
                    ? ('down' as const)
                    : ('flat' as const),
              text: formatPercent(Math.abs(change), locale, 0),
              tone: change >= 0 ? ('good' as const) : ('bad' as const),
            };
    const fine = published.filter((v) => !NEEDS_ACTION.includes(v.status));
    const logoOf = (
      ref: { connectorId: string; name: string; logo: string } | null,
      fallback: string,
    ) => ({
      name: ref ? (manifestFor(ref.connectorId)?.name ?? ref.name) : fallback,
      ...(ref?.logo ? { logoUrl: ref.logo } : {}),
    });
    return {
      title: ctx.support
        ? tp('supportOverview', { company: ctx.tenant.tenantName })
        : tp(greetingKey(now), { name: firstName }),
      subtitle: ctx.tenant.tenantName,
      hero: problems
        ? {
            problems,
            headline: tm('needs', { count: issues.length }),
            meta: tm('needsMeta', { count: fine.length }),
          }
        : {
            problems,
            headline: tm('allRunning'),
            meta: tm('allRunningMeta', {
              flows: published.length,
              errors: errorsToday,
              ago: lastRun ? formatRelative(lastRun, now, locale) : '–',
            }),
          },
      // Rows are labels on the boards, without the sentence full stop the desktop texts have.
      issues: issues.map((i) => ({
        key: i.key,
        status: i.status,
        ...i.mobile,
        title: i.mobile.title.replace(/\.$/, ''),
      })),
      kpi: {
        label: tm('recordsToday'),
        value: formatNumber(today?.records ?? 0, locale),
        ...(kpiTrend ? { trend: kpiTrend } : {}),
        data: week.map((d) => d.records),
        meta: tm('lastWeek', {
          day: cap(weekday(weekAgoDate, 'long')),
          value: formatNumber(prevRecords, locale),
        }),
      },
      ring: billing
        ? {
            label: tm('transactions'),
            ratio: billing.quota.ratio,
            percent: formatPercent(billing.quota.ratio, locale, 0),
            value: formatNumber(billing.quota.used, locale),
            of:
              billing.quota.limit === null
                ? t('unlimited')
                : tm('of', { limit: formatNumber(billing.quota.limit, locale) }),
            meta: billing.subscription.currentPeriodEnd
              ? tm('resets', { date: formatDate(billing.subscription.currentPeriodEnd, locale) })
              : '',
          }
        : null,
      week: {
        title: tm('week'),
        summary: tm('weekSummary', {
          records: formatNumber(
            week.reduce((a, d) => a + d.records, 0),
            locale,
          ),
          errors: week.reduce((a, d) => a + d.errors, 0),
        }),
        days: week,
      },
      flows: problems
        ? {
            heading: tm('flows'),
            rows: published
              .filter((v) => NEEDS_ACTION.includes(v.status))
              .map((v) => ({
                id: v.id,
                href: `/integrations/${v.id}`,
                name: v.name,
                meta:
                  v.status === 'broken'
                    ? tm('flowBroken', { when: v.statusSince ? relativeWhen(v.statusSince) : '–' })
                    : tm('flowError', {
                        count: v.openFailures,
                        ago: v.lastRunAt ? formatRelative(v.lastRunAt, now, locale) : '–',
                      }),
                status: v.status,
                statusLabel: ts(v.status),
                logo: logoOf(v.source, v.name),
              })),
            rest: fine.length
              ? {
                  title: tm('rest', { count: fine.length }),
                  meta: `${fine
                    .slice(0, 2)
                    .map((v) => v.name)
                    .join(', ')}${fine.length > 2 ? ' …' : ''}`,
                }
              : null,
          }
        : null,
      recent: {
        heading: tm('recent'),
        rows: activity.slice(0, 2).map((a) => {
          const view = views.find((v) => v.id === a.flowId);
          const route = view?.routes.find((r) => r.id === a.routeId);
          const target = route?.destination ?? '';
          return {
            key: `${a.runId}-${a.routeId}`,
            title: a.failed
              ? tm('activityFailed', { count: a.failed, target })
              : tm('activityRow', { count: a.records, target }),
            meta: `${view?.name ?? ''} · ${formatRelative(a.at, now, locale)}`,
            logo: logoOf(route?.destinationConnector ?? null, target),
          };
        }),
      },
    };
  }

  function relativeWhen(d: Date) {
    return `${formatRelativeDay(d, now, locale)} ${formatTime(d, locale)}`;
  }
}

function withTrend(
  trend: { direction: 'up' | 'down' | 'flat'; text: string } | undefined,
  suffix?: string,
) {
  if (!trend) return {};
  return { trend: { ...trend, text: suffix ? `${trend.text} ${suffix}` : trend.text } };
}

function formatRelativeDay(d: Date, now: Date, locale: 'da' | 'en') {
  const dayMs = 86_400_000;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / dayMs);
  if (diff === 0) return locale === 'da' ? 'i dag' : 'today';
  if (diff === 1) return locale === 'da' ? 'i går' : 'yesterday';
  return formatDate(d, locale);
}
