import { manifestFor } from '@agentor/connectors';
import { formatNumber, formatRelative, type Locale } from '@agentor/i18n';
import { cn, Icon, StatusPill } from '@agentor/ui';
import {
  ExpandCard,
  KV,
  MobileCard,
  MobileEmpty,
  MobileLogo,
  MobilePageTitle,
  MobileShell,
  Row,
  RowIcon,
  SectionHeading,
} from '@agentor/ui/mobile';
import {
  Activity,
  CircleCheck,
  CircleX,
  CreditCard,
  Layers,
  Mail,
  Radio,
  Server,
  Siren,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { PlatformSubTabs } from '@/components/mobile/sub-tabs';
import { IncidentButton } from '@/components/platform/admin/incident-dialog';
import type { ComponentState, StatusData } from '@/server/status-data';

const PILL: Record<ComponentState, 'ok' | 'warn' | 'error' | 'paused'> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  unknown: 'paused',
};

const ICON: Record<string, LucideIcon> = {
  app: Server,
  runs: Activity,
  webhooks: Radio,
  queues: Layers,
  mail: Mail,
  payments: CreditCard,
};

const INCIDENT_PILL = {
  investigating: 'error',
  monitoring: 'warn',
  planned: 'info',
  resolved: 'ok',
  completed: 'ok',
} as const;

/**
 * MP25 System Status: the same measurements as A1 as rows under a status banner. What isn't
 * measured yet says so ("–", "Måles ikke"), as on desktop (PLAN-2026-10-21 decision 17).
 */
export async function StatusMobile({
  d,
  summary,
  when,
}: {
  d: StatusData;
  summary: string;
  when: (from: Date, to: Date | null) => string;
}) {
  const t = await getTranslations('platform.adminStatus');
  const locale = (await getLocale()) as Locale;
  const n = (v: number) => formatNumber(v, locale);
  const overallText =
    d.overall === 'ok'
      ? t('overallOk')
      : d.overall === 'warn'
        ? t('overallWarn')
        : t('overallError');
  const meta = (key: string, ms: number | null) => {
    const time = ms === null ? null : t('ms', { ms });
    const parts =
      key === 'runs'
        ? [t('runsHourShort', { count: d.counts.runsLastHour })]
        : key === 'webhooks'
          ? [
              t('webhooksShort', {
                count: n(d.counts.webhooksToday),
                rejected: d.counts.webhooksRejectedToday,
              }),
            ]
          : key === 'queues'
            ? [
                t('queueCounts', {
                  waiting: d.queues.reduce((a, q) => a + q.waiting, 0),
                  failed: d.queues.reduce((a, q) => a + q.failed, 0),
                }),
              ]
            : [];
    if (time) parts.unshift(time);
    return parts.length ? parts.join(' · ') : t('notMeasured');
  };
  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <PlatformSubTabs />
      <MobilePageTitle title={t('title')} />
      <div
        role="status"
        className={cn(
          'flex items-start gap-2.5 rounded-md px-3.5 py-3',
          d.overall === 'ok' ? 'bg-ok-bg' : d.overall === 'warn' ? 'bg-warn-bg' : 'bg-error-bg',
        )}
      >
        <Icon
          icon={d.overall === 'ok' ? CircleCheck : d.overall === 'warn' ? TriangleAlert : CircleX}
          size={18}
          className={cn(
            'mt-0.5 flex-none',
            d.overall === 'ok'
              ? 'text-ok-fg'
              : d.overall === 'warn'
                ? 'text-warn-fg'
                : 'text-error-fg',
          )}
        />
        <span className="flex flex-col gap-0.5 leading-snug">
          <strong className="text-body">{overallText}</strong>
          <span className="text-meta">
            {t('checked', { when: formatRelative(d.checkedAt, new Date(), locale) })} · {summary}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[t('uptime'), t('queueLatency')].map((label, i) => (
          <MobileCard
            key={label}
            className={cn('flex flex-col gap-1 px-3.5 py-3', i === 0 && 'bg-hero')}
          >
            <span className="text-meta font-medium">{label}</span>
            <strong className="text-m-kpi tabular">–</strong>
            <span className="text-micro">{t('notMeasured')}</span>
          </MobileCard>
        ))}
      </div>
      <SectionHeading>{t('platformTitle')}</SectionHeading>
      <MobileCard>
        {d.components.map((c) => (
          <Row
            key={c.key}
            leading={<RowIcon icon={ICON[c.key] ?? Server} tone="neutral" />}
            title={t(`component.${c.key}` as 'component.app')}
            meta={meta(c.key, c.ms)}
            trailing={
              <StatusPill status={PILL[c.state]}>{t(`state.${c.state}` as 'state.ok')}</StatusPill>
            }
          />
        ))}
      </MobileCard>
      <SectionHeading>{t('connectorsTitle')}</SectionHeading>
      {d.connectors.length === 0 ? (
        <p className="m-0 px-1 text-body text-fg-2">{t('noConnectors')}</p>
      ) : (
        <MobileCard>
          {d.connectors.map((c) => (
            <Row
              key={c.connectorId}
              leading={
                <MobileLogo name={c.name} logoUrl={manifestFor(c.connectorId)?.logo} size={32} />
              }
              title={c.name}
              meta={t('connections', { count: c.connections })}
              trailing={
                c.broken > 0 ? (
                  <StatusPill status="broken">{t('brokenFor', { count: c.broken })}</StatusPill>
                ) : (
                  <StatusPill status="ok">{t('state.ok')}</StatusPill>
                )
              }
            />
          ))}
        </MobileCard>
      )}
      <SectionHeading>{t('incidentsTitle')}</SectionHeading>
      {d.incidents.length === 0 ? (
        <MobileEmpty icon={Siren} title={t('noIncidents')} />
      ) : (
        <div className="flex flex-col gap-2">
          {d.incidents.map((i) => {
            const tone = INCIDENT_PILL[i.status];
            return (
              <ExpandCard
                key={i.id}
                leading={
                  <RowIcon
                    icon={tone === 'ok' ? CircleCheck : TriangleAlert}
                    tone={tone === 'info' ? 'info' : tone}
                  />
                }
                title={i.title}
                meta={when(i.startsAt, i.endsAt)}
                trailing={<StatusPill status={tone}>{t(`status.${i.status}`)}</StatusPill>}
              >
                <KV k={t('colImpact')}>{i.impact || '–'}</KV>
                {i.notes && <KV k={t('colStatus')}>{i.notes}</KV>}
                <div className="pt-1.5">
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
                </div>
              </ExpandCard>
            );
          })}
        </div>
      )}
      <p className="m-0 px-1 text-meta text-fg-2">{t('platformNote')}</p>
    </MobileShell>
  );
}
