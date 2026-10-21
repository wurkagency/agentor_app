import { manifestFor } from '@agentor/connectors';
import { formatDate, formatNumber, formatRelative, formatTime, type Locale } from '@agentor/i18n';
import {
  Card,
  CardHeader,
  ConnectorLogo,
  EmptyState,
  Icon,
  KpiCard,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@agentor/ui';
import {
  Activity,
  CircleCheck,
  CircleX,
  Clock,
  Gauge,
  Siren,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { IncidentButton } from '@/components/platform/admin/incident-dialog';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { statusData, type ComponentState } from '@/server/status-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('platform.adminStatus');
  return { title: t('title') };
}

const PILL: Record<ComponentState, 'ok' | 'warn' | 'error' | 'paused'> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  unknown: 'paused',
};

/**
 * Administration › System Status (A1): the platform, its queues and connectors, and incidents.
 * Shows only what is measured today; uptime, queue latency and response times are not recorded
 * yet and say so (PLAN-2026-10-21 Q6). Superadmin only.
 */
export default async function StatusPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.adminStatus');
  const locale = (await getLocale()) as Locale;
  const d = await statusData(actor);
  const n = (v: number) => formatNumber(v, locale);
  const failedPct =
    d.counts.runsLastHour > 0
      ? formatNumber((d.counts.runsFailedLastHour / d.counts.runsLastHour) * 100, locale, 1)
      : null;
  const when = (from: Date, to: Date | null) => {
    const day = (x: Date) => formatDate(x, locale).replace(/ \d{4}$/, '');
    const start = `${day(from)} ${formatTime(from, locale)}`;
    if (!to) return `${start} –`;
    return day(to) === day(from)
      ? `${start}–${formatTime(to, locale)}`
      : `${start} – ${day(to)} ${formatTime(to, locale)}`;
  };
  const overallText =
    d.overall === 'ok'
      ? t('overallOk')
      : d.overall === 'warn'
        ? t('overallWarn')
        : t('overallError');
  const firstIssue =
    d.components.find((c) => c.state === 'error') ?? d.components.find((c) => c.state === 'warn');
  const brokenConnector = d.connectors.find((c) => c.broken > 0);
  const summary = firstIssue
    ? t(`issue.${firstIssue.key}`)
    : brokenConnector
      ? t('issueConnector', { name: brokenConnector.name, count: brokenConnector.broken })
      : t('allGood');

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <>
            <IncidentButton kind="maintenance" variant="secondary" />
            <IncidentButton kind="incident" />
          </>
        }
      />
      <div
        role="status"
        className={cn(
          'flex items-center gap-3 rounded-md px-5 py-4',
          d.overall === 'ok' ? 'bg-ok-bg' : d.overall === 'warn' ? 'bg-warn-bg' : 'bg-error-bg',
        )}
      >
        <Icon
          icon={d.overall === 'ok' ? CircleCheck : d.overall === 'warn' ? TriangleAlert : CircleX}
          size={24}
          className={
            d.overall === 'ok'
              ? 'text-ok-fg'
              : d.overall === 'warn'
                ? 'text-warn-fg'
                : 'text-error-fg'
          }
        />
        <span className="flex flex-1 flex-col gap-0.5">
          <strong className="text-nav">{overallText}</strong>
          <span className="text-meta">
            {t('checked', { when: formatRelative(d.checkedAt, new Date(), locale) })} · {summary}
          </span>
        </span>
        {d.warnings > 0 && (
          <StatusPill status={d.overall === 'error' ? 'error' : 'warn'} compact>
            {t('warnings', { count: d.warnings })}
          </StatusPill>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
        <KpiCard
          compact
          hero
          icon={Activity}
          label={t('uptime')}
          value="–"
          footer={t('notMeasured')}
        />
        <KpiCard
          compact
          icon={Clock}
          label={t('runsHour')}
          value={n(d.counts.runsLastHour)}
          footer={failedPct === null ? t('noRuns') : t('runsFailed', { pct: failedPct })}
        />
        <KpiCard
          compact
          icon={Gauge}
          label={t('queueLatency')}
          value="–"
          footer={t('notMeasured')}
        />
        <KpiCard
          compact
          icon={Webhook}
          label={t('webhooksToday')}
          value={n(d.counts.webhooksToday)}
          footer={t('webhooksRejected', { count: d.counts.webhooksRejectedToday })}
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card padding="none" className="overflow-x-auto">
          <div className="px-5 pb-2 pt-5">
            <CardHeader title={t('platformTitle')} />
          </div>
          <Table aria-label={t('platformTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colComponent')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th numeric>{t('colResponse')}</Th>
                <Th numeric className="pr-5">
                  {t('colUptime')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.components.map((c) => (
                <Tr key={c.key}>
                  <Td className="pl-5">
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">{t(`component.${c.key}`)}</span>
                      {c.key === 'runs' && d.schedulerLeader && (
                        <span className="text-meta text-fg-2">
                          {t('leader', { name: d.schedulerLeader })}
                        </span>
                      )}
                      {c.key === 'queues' && (
                        <span className="text-meta text-fg-2">
                          {t('queueCounts', {
                            waiting: d.queues.reduce((a, q) => a + q.waiting, 0),
                            failed: d.queues.reduce((a, q) => a + q.failed, 0),
                          })}
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td>
                    <StatusPill status={PILL[c.state]} compact>
                      {t(`state.${c.state}`)}
                    </StatusPill>
                  </Td>
                  <Td numeric>{c.ms === null ? '–' : t('ms', { ms: c.ms })}</Td>
                  <Td numeric className="pr-5">
                    –
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="m-0 px-5 py-3 text-meta text-fg-2 shadow-hairline-t">{t('platformNote')}</p>
        </Card>

        <Card padding="none" className="overflow-x-auto">
          <div className="px-5 pb-2 pt-5">
            <CardHeader title={t('connectorsTitle')} />
          </div>
          {d.connectors.length === 0 ? (
            <p className="m-0 px-5 pb-5 text-body text-fg-2">{t('noConnectors')}</p>
          ) : (
            <Table aria-label={t('connectorsTitle')}>
              <thead>
                <tr>
                  <Th className="pl-5">{t('colConnector')}</Th>
                  <Th>{t('colStatus')}</Th>
                  <Th numeric>{t('colP95')}</Th>
                  <Th className="pr-5">{t('colVersion')}</Th>
                </tr>
              </thead>
              <tbody>
                {d.connectors.map((c) => (
                  <Tr key={c.connectorId}>
                    <Td className="pl-5">
                      <span className="flex items-center gap-2.5">
                        <ConnectorLogo
                          connector={{ name: c.name, logoUrl: manifestFor(c.connectorId)?.logo }}
                          size={24}
                        />
                        <span className="flex flex-col leading-tight">
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-meta text-fg-2">
                            {t('connections', { count: c.connections })}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      {c.broken > 0 ? (
                        <StatusPill status="broken" compact>
                          {t('brokenFor', { count: c.broken })}
                        </StatusPill>
                      ) : (
                        <StatusPill status="ok" compact>
                          {t('state.ok')}
                        </StatusPill>
                      )}
                    </Td>
                    <Td numeric>–</Td>
                    <Td className="pr-5 font-mono text-mono">v{c.version}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="m-0 px-5 py-3 text-meta text-fg-2 shadow-hairline-t">
            {t('connectorsNote')}
          </p>
        </Card>
      </div>

      <Card padding="none" className="overflow-x-auto">
        <div className="px-5 pb-2 pt-5">
          <CardHeader title={t('incidentsTitle')} />
        </div>
        {d.incidents.length === 0 ? (
          <EmptyState icon={Siren} title={t('noIncidents')}>
            {t('noIncidentsBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('incidentsTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colTime')}</Th>
                <Th>{t('colIncident')}</Th>
                <Th>{t('colImpact')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th className="pr-5">
                  <span className="sr-only">{t('update')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.incidents.map((i) => (
                <Tr key={i.id}>
                  <Td className="pl-5 text-fg-2">{when(i.startsAt, i.endsAt)}</Td>
                  <Td className="whitespace-normal">
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">{i.title}</span>
                      {i.notes && <span className="text-meta text-fg-2">{i.notes}</span>}
                    </span>
                  </Td>
                  <Td className="whitespace-normal">{i.impact || '–'}</Td>
                  <Td>
                    <StatusPill
                      status={
                        i.status === 'investigating'
                          ? 'error'
                          : i.status === 'monitoring'
                            ? 'warn'
                            : i.status === 'planned'
                              ? 'info'
                              : 'ok'
                      }
                      compact
                    >
                      {t(`status.${i.status}`)}
                    </StatusPill>
                  </Td>
                  <Td className="pr-5 text-right">
                    <IncidentButton
                      kind={i.kind}
                      incident={{
                        id: i.id,
                        kind: i.kind,
                        title: i.title,
                        impact: i.impact,
                        status: i.status,
                        startsAt: i.startsAt.toISOString(),
                        endsAt: i.endsAt?.toISOString() ?? null,
                        notes: i.notes,
                      }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
