import { canAdd } from '@agentor/core';
import { Banner, Icon } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { FlowsTable, type FlowTableRow } from './flows-table';
import { EmptyFlows } from './empty-flows';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('integrations') };
}

/** Integrationer (D2): every flow with its routes, status, mode and recent records. */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requireAppContext();
  const [views, overview, conns] = await Promise.all([
    viewsFor(ctx),
    billingOverview(ctx),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
  ]);
  const t = await getTranslations('flows');
  const { view } = await searchParams;
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const count = (s: string) => views.filter((v) => v.status === s).length;
  const setsLimit = overview?.plan.entitlements.integrationSets ?? null;
  const atLimit = overview ? !canAdd(overview.usage.integrationSets, setsLimit) : false;

  const summary = views.length
    ? [
        t('count', { count: views.length }),
        ...(count('error') ? [t('withErrors', { count: count('error') })] : []),
        ...(count('broken') ? [t('broken', { count: count('broken') })] : []),
        ...(count('paused') ? [t('paused', { count: count('paused') })] : []),
      ].join(' · ')
    : t('noneYet', { connections: conns.size });

  const rows: FlowTableRow[] = views.map((v) => ({
    id: v.id,
    name: v.name,
    status: v.status,
    statusSince: v.statusSince?.toISOString() ?? null,
    pausedByName: v.pausedByName,
    mode: v.mode,
    records: v.records,
    openFailures: v.openFailures,
    lastRunAt: v.lastRunAt?.toISOString() ?? null,
    published: Boolean(v.published),
    connectors: [v.source, ...v.destinations]
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        id: c.id,
        connectorId: c.connectorId,
        name: c.name,
        logo: c.logo,
        status: c.status,
      })),
    brokenConnectionId:
      [v.source, ...v.destinations].find((c) => c?.status === 'broken')?.id ?? null,
    routes: v.routes.map((r) => ({
      id: r.id,
      source: r.source,
      destination: r.destination,
      status: r.status,
      mode: r.mode,
      records: r.records,
      failed: r.failed,
      openFailures: r.openFailures,
      lastAt: r.lastAt?.toISOString() ?? null,
      pausedBy: r.pausedBy,
    })),
  }));

  const newFlow = canEdit ? (
    <ButtonLink
      variant="primary"
      size="l"
      href="/integrations/new"
      aria-disabled={atLimit || undefined}
    >
      <Icon icon={Plus} size={18} />
      {t('newFlow')}
    </ButtonLink>
  ) : undefined;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={atLimit ? t('allSetsUsed') : summary}
        actions={newFlow}
      />
      {atLimit && overview && (
        <Banner
          tone="warn"
          title={t('limitTitle', { plan: overview.plan.name })}
          action={
            ctx.tenant.role === 'owner' ? (
              <ButtonLink variant="dark" size="s" href="/billing">
                {t('seePlans')}
              </ButtonLink>
            ) : undefined
          }
        >
          {t('limitBody')}
        </Banner>
      )}
      {rows.length === 0 ? (
        <EmptyFlows
          connected={[...conns.values()].filter((c) => c.status === 'ok').map((c) => c.connectorId)}
          canEdit={canEdit}
        />
      ) : (
        <FlowsTable rows={rows} canEdit={canEdit} developer={view === 'developer'} />
      )}
    </PageBody>
  );
}
