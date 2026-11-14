import { manifestFor } from '@agentor/connectors';
import { openFailures, searchRecords } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireAppContext } from '@/server/auth/session';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { SearchMobile } from './search-mobile';

export async function generateMetadata() {
  const t = await getTranslations('mobile.search');
  return { title: t('title') };
}

/**
 * MA17 Søg: order numbers and customers (searched on the server), flows and connections, quick
 * actions. The same data as the ⌘K palette (D1-Soeg); on a computer that palette is the search.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireAppContext();
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const q = ((await searchParams).q ?? '').slice(0, 64);
  const [views, conns, failures, records] = await Promise.all([
    viewsFor(ctx),
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    openFailures(db(), c),
    q.trim().length >= 2 ? searchRecords(db(), c, q, 5) : Promise.resolve([]),
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const t = await getTranslations('mobile.search');
  return (
    <Responsive
      desktop={<DesktopRedirect href="/" label={t('title')} />}
      mobile={
        <SearchMobile
          initialQuery={q}
          initialRecords={records.map((r) => ({
            label: r.label,
            customer: r.customer,
            outcome: r.outcome,
            flowId: r.flowId,
            at: r.createdAt.toISOString(),
          }))}
          flows={views.map((v) => ({
            id: v.id,
            name: v.name,
            routes: v.routes.length,
            logo: v.source
              ? {
                  name: manifestFor(v.source.connectorId)?.name ?? v.source.name,
                  ...(v.source.logo ? { logoUrl: v.source.logo } : {}),
                }
              : { name: v.name },
          }))}
          connections={[...conns.values()].map((x) => ({
            id: x.id,
            label: `${manifestFor(x.connectorId)?.name ?? x.connectorId} · ${x.name}`,
            logo: {
              name: manifestFor(x.connectorId)?.name ?? x.name,
              ...(x.logo ? { logoUrl: x.logo } : {}),
            },
          }))}
          failuresToday={
            new Set(
              failures
                .filter((f) => f.createdAt >= startOfDay)
                .map((f) => `${f.routeId}:${f.sourceId}`),
            ).size
          }
        />
      }
    />
  );
}
