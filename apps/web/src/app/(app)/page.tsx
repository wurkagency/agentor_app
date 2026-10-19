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
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, NEEDS_ACTION, PERIOD_DAYS, periodOf, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { NewCustomer } from './new-customer';
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
  const period = periodOf((await searchParams).period);
  const days = PERIOD_DAYS[period];
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const t = await getTranslations('overview');
  const tp = await getTranslations('pages');
  const ts = await getTranslations('status');
  const te = await getTranslations('recordErrors');
  const nav = await getTranslations('nav');
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
    dailyNumbers(db(), c, Math.max(days, 7)),
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

  return (
    <>
      {header}
      <PageBody>
        <PageHeader
          title={tp(greetingKey(now), { name: firstName })}
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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
