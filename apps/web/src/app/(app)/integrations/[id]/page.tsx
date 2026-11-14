import { manifestFor } from '@agentor/connectors';
import { getRun, isUuid, listRuns, listVersions, openFailures, overviewNumbers } from '@agentor/db';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from '@agentor/i18n';
import {
  Banner,
  Card,
  CardHeader,
  ConnectorLogo,
  ModeBadge,
  StatCard,
  StatusPill,
} from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LinkTabs } from '@/components/link-tabs';
import { explain } from '@/components/flows/record-error';
import { recordFacts } from '@/components/flows/record-facts';
import { routeTarget } from '@/components/flows/helpers';
import { PageBody } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { FlowActions, RestoreVersionButton, RetryButton, RouteResume } from './flow-actions';
import { RunsView } from './runs-view';
import { Responsive } from '@agentor/ui/mobile';
import { FlowMobile, RoutesMobile } from './mobile';
import { RunsMobile } from './runs/mobile';

export async function generateMetadata() {
  const t = await getTranslations('flows');
  return { title: t('title') };
}

const TABS = ['overview', 'runs', 'routes', 'settings'] as const;

/** Flowdetalje (D7 oversigt/fejl, D8 kørsler): how the flow works and what it did. */
export default async function FlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; run?: string; record?: string; view?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const views = await viewsFor(ctx);
  const f = views.find((v) => v.id === id);
  if (!f) notFound();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'overview';
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const t = await getTranslations('flows');
  const ts = await getTranslations('status');
  const tm = await getTranslations('mode');
  const te = await getTranslations('recordErrors');
  const locale = (await getLocale()) as 'da' | 'en';
  const now = new Date();
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const developer = sp.view === 'developer';
  const conns = await connectionMap(ctx.tenant.tenantId, ctx.user.id);
  const failures = await openFailures(db(), c, id);
  const base = `/integrations/${id}`;
  const rel = (d: Date | null) =>
    d
      ? now.getTime() - d.getTime() > 2 * 86_400_000
        ? formatDate(d, locale)
        : formatRelative(d, now, locale)
      : t('never');

  // Open failures grouped by route and cause (D7-Flow-Fejl banner).
  const groups = new Map<string, typeof failures>();
  for (const r of failures) {
    const key = `${r.routeId}:${r.errorCode}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const banners = [...groups.values()].map((rows) => {
    const first = rows[0]!;
    const target = routeTarget(f.definition, conns, first.routeId);
    const e = explain((k, p) => te(k, p), {
      errorCode: first.errorCode,
      errorParams: first.errorParams,
      label: rows.map((r) => r.label).join(' og '),
      entity: first.entity,
      system: target.system,
      fieldLabel: target.fieldLabel(first.errorParams?.field),
    });
    return {
      routeId: first.routeId,
      title: te(
        `summary.${first.entity === 'creditNote' ? 'creditNote' : first.entity === 'order' ? 'order' : 'record'}`,
        {
          count: new Set(rows.map((r) => r.sourceId)).size,
          system: target.system,
        },
      ),
      why: e.why,
      count: new Set(rows.map((r) => r.sourceId)).size,
      runId: first.runId,
    };
  });

  const status =
    f.status === 'error' || f.status === 'broken'
      ? ts('since', {
          status: ts(f.status),
          time: f.statusSince ? formatTime(f.statusSince, locale) : '',
        })
      : f.status === 'ok'
        ? t('allRoutesRunning')
        : ts(f.status);

  const desktop = (
    <PageBody>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="eyebrow m-0">{t('title')}</p>
          <h1 className="m-0 text-page">{f.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-meta text-fg-2">
            <StatusPill status={f.status}>{status}</StatusPill>
            <span>
              {t('routes', { count: f.routes.length })}
              {f.published
                ? ` · ${t('publishedBy', {
                    number: f.published.number,
                    name: f.published.publishedByName ?? '–',
                    date: f.published.publishedAt
                      ? formatDate(f.published.publishedAt, locale)
                      : '',
                  })}`
                : ` · ${t('notPublished')}`}
            </span>
          </div>
        </div>
        <FlowActions
          id={id}
          canEdit={canEdit}
          paused={f.pausedAt !== null}
          published={Boolean(f.published)}
          developer={developer}
        />
      </div>

      <LinkTabs
        label={t('tabsLabel')}
        active={tab}
        items={TABS.map((k) => ({
          key: k,
          href: `${base}${k === 'overview' ? '' : `?tab=${k}`}${developer ? `${k === 'overview' ? '?' : '&'}view=developer` : ''}`,
          label: t(`tab.${k}`),
        }))}
      />

      {tab === 'overview' && (
        <>
          {banners.map((b) => (
            <Banner
              key={b.routeId + b.title}
              tone="error"
              title={b.title}
              action={
                <span className="flex gap-2">
                  <a
                    href={`${base}?tab=runs&run=${b.runId}`}
                    className="inline-flex h-8 items-center rounded-full px-3 text-table font-semibold text-fg-1 shadow-ring-chip no-underline"
                  >
                    {t('seeErrors')}
                  </a>
                  {canEdit && <RetryButton flowId={id} routeId={b.routeId} count={b.count} />}
                </span>
              }
            >
              {b.why}
            </Banner>
          ))}
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="flex flex-col gap-4 lg:col-span-7">
              <CardHeader title={t('howItWorks')} />
              <div className="flex flex-wrap items-center gap-3">
                {f.source && (
                  <span className="flex items-center gap-2 text-table font-semibold">
                    <ConnectorLogo connector={{ name: f.source.name, logoUrl: f.source.logo }} />
                    {manifestFor(f.source.connectorId)?.name} · {f.source.name}
                  </span>
                )}
                <span className="text-fg-2">→</span>
                {f.destinations.map((d) => (
                  <span key={d.id} className="flex items-center gap-2 text-table">
                    <ConnectorLogo connector={{ name: d.name, logoUrl: d.logo }} size={24} />
                    {f.routes.filter((r) => r.destinationConnector?.id === d.id).length > 1
                      ? t('destRoutes', {
                          name: manifestFor(d.connectorId)?.name ?? d.name,
                          count: f.routes.filter((r) => r.destinationConnector?.id === d.id).length,
                        })
                      : (manifestFor(d.connectorId)?.name ?? d.name)}
                  </span>
                ))}
              </div>
              <p className="m-0 text-body text-fg-1">
                {f.routes
                  .map((r) =>
                    t(`sentence.${r.status === 'paused' ? 'paused' : r.mode}`, {
                      source: r.source,
                      destination: r.destination,
                      name: r.pausedBy ?? '',
                    }),
                  )
                  .join(' ')}
              </p>
            </Card>
            <FlowNumbers
              flowId={id}
              ctx={c}
              nextRunAt={f.nextRunAt}
              pollMinutes={f.definition?.pollMinutes ?? 5}
              lastRunAt={f.lastRunAt}
            />
          </div>
          <RoutesCard f={f} canEdit={canEdit} rel={rel} t={t} ts={ts} tm={tm} locale={locale} />
        </>
      )}

      {tab === 'routes' && (
        <RoutesCard f={f} canEdit={canEdit} rel={rel} t={t} ts={ts} tm={tm} locale={locale} />
      )}

      {tab === 'runs' && (
        <RunsTab
          flowId={id}
          ctx={c}
          runParam={sp.run}
          recordParam={sp.record}
          developer={developer}
          canEdit={canEdit}
          definition={f.definition}
          conns={conns}
          routes={f.routes.map((r) => ({
            id: r.id,
            label: `${r.source} → ${r.destination.split(' ').slice(1).join(' ') || r.destination}`,
          }))}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          flowId={id}
          ctx={c}
          canEdit={canEdit}
          pollMinutes={f.definition?.pollMinutes ?? 5}
        />
      )}
    </PageBody>
  );
  const mobile =
    tab === 'routes' ? (
      <RoutesMobile f={f} canEdit={canEdit} />
    ) : tab === 'runs' ? (
      <RunsMobile f={f} ctx={c} />
    ) : (
      <FlowMobile f={f} ctx={c} conns={conns} canEdit={canEdit} />
    );
  return <Responsive desktop={desktop} mobile={mobile} />;
}

async function FlowNumbers({
  flowId,
  ctx,
  nextRunAt,
  pollMinutes,
  lastRunAt,
}: {
  flowId: string;
  ctx: { tenantId: string; userId: string };
  nextRunAt: Date | null;
  pollMinutes: number;
  lastRunAt: Date | null;
}) {
  const t = await getTranslations('flows');
  const locale = (await getLocale()) as 'da' | 'en';
  const n = await overviewNumbers(db(), ctx, 7, { flowId });
  const now = new Date();
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:col-span-5">
      <StatCard label={t('kpi.records')} value={formatNumber(n.current.records, locale)} />
      <StatCard
        label={t('kpi.revenue')}
        value={formatNumber(Math.round(n.current.revenueOre / 100), locale)}
        unit="kr."
      />
      <StatCard
        label={t('kpi.errorRate')}
        value={formatPercent(n.current.errorRate, locale, 1).replace(/\s?%/, '')}
        unit="%"
      />
      <StatCard
        label={t('kpi.nextRun')}
        value={nextRunAt ? formatTime(nextRunAt, locale) : '–'}
        footer={
          <p className="m-0 text-meta text-fg-2">
            {nextRunAt
              ? `${t('inMinutes', { count: Math.max(0, Math.round((nextRunAt.getTime() - now.getTime()) / 60_000)) })} · `
              : ''}
            {t('everyMinutes', { count: pollMinutes })}
            {lastRunAt
              ? ` · ${t('lastRun', { when: formatRelative(lastRunAt, now, locale) })}`
              : ''}
          </p>
        }
      />
    </div>
  );
}

function RoutesCard({
  f,
  canEdit,
  rel,
  t,
  ts,
  tm,
  locale,
}: {
  f: Awaited<ReturnType<typeof viewsFor>>[number];
  canEdit: boolean;
  rel: (d: Date | null) => string;
  t: Awaited<ReturnType<typeof getTranslations<'flows'>>>;
  ts: Awaited<ReturnType<typeof getTranslations<'status'>>>;
  tm: Awaited<ReturnType<typeof getTranslations<'mode'>>>;
  locale: 'da' | 'en';
}) {
  return (
    <Card padding="none" className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="m-0 text-card">{t('routesTitle')}</h2>
        <span className="text-meta text-fg-2">{t('rollUpNote')}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {f.routes.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-4 border-t border-border px-5 py-3"
          >
            <span className="w-44">
              <StatusPill status={r.status} compact>
                {r.status === 'paused' && r.pausedBy
                  ? t('pausedBy', { name: r.pausedBy })
                  : ts(r.status)}
              </StatusPill>
            </span>
            <ModeBadge mode={r.mode} small>
              {tm(r.mode)}
            </ModeBadge>
            <span className="min-w-0 flex-1 text-table font-semibold">
              {r.source} <span className="text-fg-2">→</span> {r.destination}
            </span>
            <span className="text-table tabular">
              {formatNumber(r.records, locale)}{' '}
              <span className="text-meta text-fg-2">{t('records7d')}</span>
            </span>
            <span className="w-32 text-meta text-fg-2">{rel(r.lastAt)}</span>
            <span className="w-28 text-right">
              {canEdit && r.status === 'paused' && r.pausedBy && (
                <RouteResume flowId={f.id} routeId={r.id} />
              )}
              {canEdit && r.openFailures > 0 && (
                <RetryButton flowId={f.id} routeId={r.id} count={r.openFailures} />
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function RunsTab({
  flowId,
  ctx,
  runParam,
  recordParam,
  developer,
  canEdit,
  definition,
  conns,
  routes,
}: {
  flowId: string;
  ctx: { tenantId: string; userId: string };
  runParam: string | undefined;
  recordParam: string | undefined;
  developer: boolean;
  canEdit: boolean;
  definition: Awaited<ReturnType<typeof viewsFor>>[number]['definition'];
  conns: Awaited<ReturnType<typeof connectionMap>>;
  routes: { id: string; label: string }[];
}) {
  const te = await getTranslations('recordErrors');
  const trf = await getTranslations('runs');
  const locale = (await getLocale()) as 'da' | 'en';
  const since = new Date(Date.now() - 86_400_000);
  const runs = await listRuns(db(), ctx, flowId, since);
  const selectedId = runParam && isUuid(runParam) ? runParam : runs[0]?.id;
  const detail = selectedId ? await getRun(db(), ctx, selectedId) : null;
  const record =
    detail?.records.find((r) => r.id === recordParam) ??
    detail?.records.find((r) => r.outcome === 'failed') ??
    null;
  const target = record ? routeTarget(definition, conns, record.routeId) : null;
  const preview = (record?.preview ?? null) as { customer?: string; country?: string } | null;
  const explanation =
    record && record.outcome === 'failed' && target
      ? explain((k, p) => te(k, p), {
          errorCode: record.errorCode,
          errorParams: record.errorParams,
          label: record.label,
          entity: record.entity,
          customer: preview?.customer ?? null,
          country: preview?.country ?? null,
          system: target.system,
          fieldLabel: target.fieldLabel(record.errorParams?.field),
        })
      : null;
  return (
    <RunsView
      flowId={flowId}
      developer={developer}
      canEdit={canEdit}
      runs={runs.map((r) => ({
        id: r.id,
        time: formatTime(r.startedAt, locale),
        total: r.recordsTotal - r.recordsSkipped,
        failed: r.recordsFailed,
        status: r.status,
      }))}
      selected={
        detail
          ? {
              id: detail.run.id,
              time: formatTime(detail.run.startedAt, locale),
              total: detail.run.recordsTotal,
              ok: detail.run.recordsOk,
              failed: detail.run.recordsFailed,
              seconds: detail.run.durationMs
                ? (detail.run.durationMs / 1000).toLocaleString('da-DK', {
                    maximumFractionDigits: 1,
                  })
                : null,
              records: detail.records.map((r) => ({
                id: r.id,
                label: r.label,
                route: routes.find((x) => x.id === r.routeId)?.label ?? r.routeId,
                outcome: r.outcome,
                amount: r.amountOre === null ? '–' : formatMoney(r.amountOre / 100, locale),
              })),
            }
          : null
      }
      record={
        record && explanation
          ? {
              id: record.id,
              routeId: record.routeId,
              title: explanation.what,
              subtitle: [
                preview?.customer,
                record.amountOre !== null ? formatMoney(record.amountOre / 100, locale) : null,
                routes.find((x) => x.id === record.routeId)?.label,
              ]
                .filter(Boolean)
                .join(' · '),
              why: explanation.why,
              steps: explanation.steps,
              mappingField: explanation.mappingField,
              code: record.errorCode,
              debug: record.debug ? JSON.stringify(record.debug, null, 2) : null,
              facts: recordFacts(
                record,
                (k, v) => trf(k as 'facts.recordId', v),
                locale,
                routes.find((x) => x.id === record.routeId)?.label,
              ),
            }
          : null
      }
    />
  );
}

async function SettingsTab({
  flowId,
  ctx,
  canEdit,
  pollMinutes,
}: {
  flowId: string;
  ctx: { tenantId: string; userId: string };
  canEdit: boolean;
  pollMinutes: number;
}) {
  const t = await getTranslations('flows');
  const locale = (await getLocale()) as 'da' | 'en';
  const versions = await listVersions(db(), ctx, flowId);
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card className="flex flex-col gap-3 lg:col-span-5">
        <CardHeader title={t('settingsTitle')} />
        <p className="m-0 text-table">{t('everyMinutes', { count: pollMinutes })}</p>
        <p className="m-0 text-meta text-fg-2">{t('settingsNote')}</p>
      </Card>
      <Card padding="none" className="flex flex-col lg:col-span-7">
        <div className="px-5 pb-3 pt-5">
          <CardHeader title={t('versions')} />
        </div>
        <ul className="m-0 list-none p-0">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-baseline justify-between gap-3 border-t border-border px-5 py-2.5 text-table"
            >
              <span className="font-semibold">
                {v.state === 'draft' ? t('draftVersion') : `v${v.number}`}
                {v.state === 'published' && (
                  <span className="ml-2 text-meta font-medium text-ok-fg">{t('current')}</span>
                )}
              </span>
              <span className="flex items-center gap-3 text-meta text-fg-2">
                {v.state === 'draft'
                  ? t('editedAt', { when: formatDate(v.updatedAt, locale) })
                  : `${v.publishedByName ?? '–'} · ${v.publishedAt ? formatDate(v.publishedAt, locale) : ''}`}
                {canEdit && v.state === 'archived' && v.number !== null && (
                  <RestoreVersionButton flowId={flowId} versionId={v.id} number={v.number} />
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
