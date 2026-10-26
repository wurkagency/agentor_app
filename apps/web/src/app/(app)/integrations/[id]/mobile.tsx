import { manifestFor } from '@agentor/connectors';
import { diffDefinitions, parseDefinition } from '@agentor/flows';
import { listRuns, openFailures, overviewNumbers } from '@agentor/db';
import { formatDate, formatNumber, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import { buttonVariants, cn, Icon, StatusPill } from '@agentor/ui';
import {
  BigButtonLink,
  DeskNote,
  ExpandCard,
  KV,
  LogoChain,
  MobileCard,
  MobileShell,
  Row,
  RowLink,
  SectionHeading,
  StackedStatus,
} from '@agentor/ui/mobile';
import { RotateCw } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { routeTarget } from '@/components/flows/helpers';
import { explain } from '@/components/flows/record-error';
import { describeFilters } from '@/components/editor/model';
import { AppTopBar } from '@/components/mobile/chrome';
import type { connectionMap, FlowView } from '@/server/flows';
import { db } from '@/server/infra';
import { FlowPauseButton } from './pause-button';

type Conns = Awaited<ReturnType<typeof connectionMap>>;
type Ctx = { tenantId: string; userId: string };

const sysName = (c: { connectorId: string; name: string }) =>
  manifestFor(c.connectorId)?.name ?? c.name;
const logo = (c: { connectorId: string; name: string; logo: string }) => ({
  name: sysName(c),
  ...(c.logo ? { logoUrl: c.logo } : {}),
});
const routeLabel = (r: { source: string; destination: string }) => `${r.source} → ${r.destination}`;

/** MA05 Flow: status, today's numbers, retry and pause, routes read-only. */
export async function FlowMobile({
  f,
  ctx,
  conns,
  canEdit,
}: {
  f: FlowView;
  ctx: Ctx;
  conns: Conns;
  canEdit: boolean;
}) {
  const t = await getTranslations('mobile.flow');
  const ts = await getTranslations('status');
  const tm = await getTranslations('mode');
  const te = await getTranslations('recordErrors');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const [today, failures, runs] = await Promise.all([
    overviewNumbers(db(), ctx, 1, { flowId: f.id }),
    openFailures(db(), ctx, f.id),
    listRuns(db(), ctx, f.id, new Date(now.getTime() - 86_400_000)),
  ]);
  const failedRecords = new Set(failures.map((x) => `${x.routeId}:${x.sourceId}`)).size;
  const firstFailure = failures[0];
  const why = (routeId: string) => {
    const fail = failures.find((x) => x.routeId === routeId);
    if (!fail) return '';
    const target = routeTarget(f.definition, conns, routeId);
    return explain((k, p) => te(k, p), {
      errorCode: fail.errorCode,
      errorParams: fail.errorParams,
      label: fail.label,
      entity: fail.entity,
      system: target.system,
      fieldLabel: target.fieldLabel(fail.errorParams?.field),
    })
      .short.replace(/\.$/, '')
      .replace(/^./, (c) => c.toLowerCase());
  };
  const subtitle = f.source
    ? `${sysName(f.source)} → ${[...new Set(f.destinations.map(sysName))].join(', ')}`
    : undefined;

  return (
    <MobileShell topBar={<AppTopBar back="/integrations" title={f.name} subtitle={subtitle} />}>
      <MobileCard>
        <div className="flex flex-col gap-2.5 p-4">
          <span className="flex items-center gap-1.5">
            {f.source && (
              <LogoChain
                source={logo(f.source)}
                destinations={f.destinations.map(logo)}
                size={28}
              />
            )}
            <span className="flex-1" />
            <StatusPill status={f.published ? f.status : 'draft'}>
              {ts(f.published ? f.status : 'draft')}
            </StatusPill>
          </span>
          <div className="flex justify-between text-table">
            <span className="font-medium text-fg-2">{t('lastRun')}</span>
            <strong>{f.lastRunAt ? formatRelative(f.lastRunAt, now, locale) : '–'}</strong>
          </div>
          <div className="flex justify-between text-table">
            <span className="font-medium text-fg-2">{t('recordsToday')}</span>
            <strong className="tabular">
              {failedRecords
                ? t('recordsValue', {
                    records: formatNumber(today.current.records, locale),
                    failed: failedRecords,
                  })
                : formatNumber(today.current.records, locale)}
            </strong>
          </div>
        </div>
        {canEdit && f.published && (
          <div className="flex gap-2 px-4 pb-4">
            {firstFailure && (
              <Link
                href={`/integrations/${f.id}/runs/${firstFailure.runId}`}
                className={cn(buttonVariants({ variant: 'primary' }), 'h-11 flex-1 no-underline')}
              >
                <Icon icon={RotateCw} size={16} />
                {t('retryN', { count: failedRecords })}
              </Link>
            )}
            <FlowPauseButton flowId={f.id} paused={f.status === 'paused'} />
          </div>
        )}
      </MobileCard>

      <div className="mx-1 mt-3.5 flex items-baseline justify-between">
        <SectionHeading flush>{t('routes')}</SectionHeading>
        <Link
          href={`/integrations/${f.id}?tab=routes`}
          className="touch-target text-table font-semibold text-fg-1"
        >
          {t('details')}
        </Link>
      </div>
      <MobileCard>
        {f.routes.map((r) => (
          <Row
            key={r.id}
            title={routeLabel(r)}
            meta={
              r.openFailures
                ? t('routeFailed', { count: r.openFailures, why: why(r.id) })
                : r.lastAt
                  ? formatRelative(r.lastAt, now, locale)
                  : '–'
            }
            trailing={<StackedStatus status={r.status} label={ts(r.status)} meta={tm(r.mode)} />}
          />
        ))}
      </MobileCard>

      <MobileCard>
        <RowLink
          href={`/integrations/${f.id}/runs`}
          linkAs={Link}
          title={t('runs')}
          meta={
            runs[0]
              ? t('runsMeta', { time: formatTime(runs[0].startedAt, locale), count: runs.length })
              : t('noRuns')
          }
        />
      </MobileCard>
      <DeskNote>{t('deskNote')}</DeskNote>
    </MobileShell>
  );
}

/** MA20 Ruter: routes grouped by destination, folding out to mode, status, filter and schedule. */
export async function RoutesMobile({ f, canEdit }: { f: FlowView; canEdit: boolean }) {
  const t = await getTranslations('mobile.flow');
  const tf = await getTranslations('flows');
  const ts = await getTranslations('status');
  const tm = await getTranslations('mode');
  const te = await getTranslations('editor');
  const locale = (await getLocale()) as Locale;
  const def = f.definition;
  const destinations = [
    ...new Map(
      f.routes
        .map((r) => r.destinationConnector)
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => [c.id, c]),
    ).values(),
  ];
  const poll = def?.pollMinutes ?? 5;
  const changes =
    f.draft?.definition && f.published
      ? diffDefinitions(parseOrNull(f.published.definition), f.draft.definition).length
      : 0;
  const nextVersion = (f.published?.number ?? 0) + 1;

  return (
    <MobileShell
      topBar={
        <AppTopBar
          back={`/integrations/${f.id}`}
          title={f.name}
          subtitle={t('routesSubtitle', { count: f.routes.length })}
        />
      }
    >
      <MobileCard>
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="flex items-center justify-between gap-2">
            <strong className="text-body">{f.name}</strong>
            <StatusPill status={f.published ? f.status : 'draft'}>
              {ts(f.published ? f.status : 'draft')}
            </StatusPill>
          </span>
          {f.source && (
            <span className="text-meta font-medium text-fg-2">
              {t('source', {
                system: sysName(f.source),
                name: f.source.name,
                routes: tf('routes', { count: f.routes.length }),
                count: destinations.length,
              })}
            </span>
          )}
          <span className="text-meta font-medium text-fg-2">
            {f.published
              ? [
                  t('published', { n: f.published.number }),
                  ...(changes ? [t('draftChanges', { count: changes })] : []),
                ].join(' · ')
              : t('notPublished')}
          </span>
        </div>
      </MobileCard>

      {destinations.map((d) => (
        <section key={d.id} className="flex flex-col gap-2" aria-label={sysName(d)}>
          <SectionHeading>
            {sysName(d)} · {d.name}
          </SectionHeading>
          {f.routes
            .filter((r) => r.destinationConnector?.id === d.id)
            .map((r) => {
              const route = def?.routes.find((x) => x.id === r.id);
              const filter = route?.filters?.length
                ? describeFilters((k, p) => te(k, p), route.filters)
                : t('allRecords');
              const status =
                r.openFailures > 0 ? `${ts(r.status)} · ${r.openFailures}` : ts(r.status);
              return (
                <ExpandCard
                  key={r.id}
                  title={`${r.source} → ${r.destination.replace(`${sysName(d)} `, '')}`}
                  meta={filter.charAt(0).toUpperCase() + filter.slice(1)}
                  trailing={<StatusPill status={r.status}>{status}</StatusPill>}
                >
                  <KV k={t('mode')}>{tm(r.mode)}</KV>
                  <KV k={t('status')}>{status}</KV>
                  <KV k={t('filter')}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</KV>
                  <KV k={t('run')}>
                    {r.status === 'paused' && r.pausedAt
                      ? t('pausedAt', { date: formatDate(new Date(r.pausedAt), locale) })
                      : t('everyMinute', { count: poll })}
                  </KV>
                </ExpandCard>
              );
            })}
        </section>
      ))}
      <DeskNote>{t('routesDesk')}</DeskNote>
      {canEdit && changes > 0 && (
        <div className="mt-auto flex gap-2">
          <BigButtonLink
            href={`/integrations/${f.id}/test`}
            variant="secondary"
            linkAs={Link}
            className="flex-1"
          >
            {t('testRun')}
          </BigButtonLink>
          <BigButtonLink href={`/integrations/${f.id}/publish`} linkAs={Link} className="flex-1">
            {t('publish', { n: nextVersion })}
          </BigButtonLink>
        </div>
      )}
    </MobileShell>
  );
}

function parseOrNull(raw: Record<string, unknown>) {
  try {
    return parseDefinition(raw);
  } catch {
    return null;
  }
}
