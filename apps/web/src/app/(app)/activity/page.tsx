import { listActivity } from '@agentor/db';
import { formatMoney, formatNumber, formatTime, formatDate } from '@agentor/i18n';
import { Icon, StatusPill, Table, Td, Th, Tr } from '@agentor/ui';
import { Download } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { explain } from '@/components/flows/record-error';
import { routeTarget } from '@/components/flows/helpers';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { ActivityFilters, ActivityRetry } from './activity-filters';
import { toActivityFilter, type ActivityQuery } from './query';
import { Responsive } from '@agentor/ui/mobile';
import { ActivityMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('activity');
  return { title: t('title') };
}

const OUTCOME = {
  created: 'ok',
  updated: 'ok',
  skipped: 'paused',
  failed: 'error',
  would_create: 'info',
  would_update: 'info',
  waiting: 'warn',
} as const;

/** Aktivitet · Log (D10): every record Agentor handled, filterable and exportable. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivityQuery>;
}) {
  const ctx = await requireAppContext();
  const q = await searchParams;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const filter = toActivityFilter(q, 51);
  const [rows, views, conns, billing] = await Promise.all([
    listActivity(db(), c, filter),
    viewsFor(ctx, 30),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    billingOverview(ctx),
  ]);
  const t = await getTranslations('activity');
  const tr = await getTranslations('runs');
  const te = await getTranslations('recordErrors');
  const locale = (await getLocale()) as 'da' | 'en';
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const page = rows.slice(0, 50);
  const hasMore = rows.length > 50;
  const failed = page.filter((r) => r.outcome === 'failed').length;
  const retentionDays = billing?.plan.entitlements.payloadRetentionDays ?? 30;

  const label = (flowId: string, routeId: string) => {
    const v = views.find((x) => x.id === flowId);
    const r = v?.routes.find((x) => x.id === routeId);
    return `${v?.name ?? ''} · ${r ? `${r.source} → ${r.destination.split(' ').slice(1).join(' ') || r.destination}` : routeId}`;
  };
  const outcomeText = (r: (typeof page)[number]) => {
    if (r.outcome === 'failed') {
      const v = views.find((x) => x.id === r.flowId);
      const target = routeTarget(v?.definition ?? null, conns, r.routeId);
      const e = explain((k, p) => te(k, p), {
        errorCode: r.errorCode,
        errorParams: r.errorParams,
        label: r.label,
        entity: r.entity,
        system: target.system,
        fieldLabel: target.fieldLabel(r.errorParams?.field),
      });
      return `${tr('outcome.failed')} · ${e.short.toLowerCase().replace(/\.$/, '')}`;
    }
    if (r.outcome === 'skipped' && r.skipReason?.startsWith('filter:total'))
      return tr('skippedZero');
    if (r.outcome === 'waiting') return tr('waitingBroken');
    return tr(`outcomeEntity.${r.outcome}.${r.entity}` as 'outcomeEntity.created.order');
  };
  const params = new URLSearchParams(
    Object.entries(q).filter(([k, v]) => v && k !== 'before') as [string, string][],
  );
  const next = hasMore ? new URLSearchParams(params) : null;
  next?.set('before', page[page.length - 1]!.createdAt.toISOString());

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro', { days: retentionDays, plan: billing?.plan.name ?? '' })}
        actions={
          <ButtonLink variant="secondary" href={`/activity/export?${params}`} prefetch={false}>
            <Icon icon={Download} size={16} />
            {t('export')}
          </ButtonLink>
        }
      />
      <ActivityFilters
        query={q}
        flows={views.map((v) => ({ id: v.id, name: v.name }))}
        summary={t('summary', { count: formatNumber(page.length, locale), failed })}
      />
      <div className="overflow-x-auto rounded-md bg-surface shadow-sm">
        <Table aria-label={t('tableLabel')}>
          <thead>
            <tr>
              <Th>{t('col.time')}</Th>
              <Th>{t('col.flowRoute')}</Th>
              <Th>{t('col.record')}</Th>
              <Th>{t('col.outcome')}</Th>
              <Th numeric>{t('col.amount')}</Th>
              <Th numeric>{t('col.duration')}</Th>
              <Th>
                <span className="sr-only">{t('col.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <Tr key={r.id} interactive>
                <Td className="tabular text-fg-2">
                  {q.period && q.period !== 'today' ? `${formatDate(r.createdAt, locale)} ` : ''}
                  {formatTime(r.createdAt, locale)}
                </Td>
                <Td className="max-w-80 truncate">{label(r.flowId, r.routeId)}</Td>
                <Td className="font-mono text-mono">{r.label}</Td>
                <Td>
                  <StatusPill status={r.mode === 'test' ? 'info' : OUTCOME[r.outcome]} compact>
                    {r.mode === 'test' ? tr('testWould') : outcomeText(r)}
                  </StatusPill>
                </Td>
                <Td numeric>
                  {r.amountOre === null ? '–' : formatMoney(r.amountOre / 100, locale)}
                </Td>
                <Td numeric className="text-fg-2">
                  {r.durationMs && r.outcome !== 'skipped'
                    ? `${formatNumber(r.durationMs / 1000, locale, 1)} s`
                    : '–'}
                </Td>
                <Td className="text-right">
                  {canEdit && r.outcome === 'failed' && !r.resolvedAt && (
                    <ActivityRetry flowId={r.flowId} routeId={r.routeId} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {page.length === 0 && <p className="m-0 px-5 py-8 text-center text-fg-2">{t('empty')}</p>}
      </div>
      {next && (
        <div className="flex justify-center">
          <ButtonLink variant="secondary" href={`/activity?${next}`} scroll={false}>
            {t('loadMore')}
          </ButtonLink>
        </div>
      )}
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <ActivityMobile
          ctx={ctx}
          views={views}
          conns={conns}
          query={{ outcome: q.outcome, flow: q.flow }}
        />
      }
    />
  );
}
