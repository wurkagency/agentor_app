import { CATALOGUE, manifestFor } from '@agentor/connectors';
import { listConnections } from '@agentor/db';
import { EmptyState, Icon } from '@agentor/ui';
import { Plug, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { ConnectionCard } from '@/components/connections/connection-card';
import { CheckingRefresh } from '@/components/connections/checking-refresh';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';

const ORDER = CATALOGUE.map((c) => c.id);

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('title') };
}

/** Mine forbindelser (D9-Forbindelser). Everyone sees them; owners, admins and developers manage. */
export default async function ConnectionsPage() {
  const ctx = await requireAppContext();
  const rows = await listConnections(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  const t = await getTranslations('connections');
  const canManage = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const broken = rows.filter((r) => r.status === 'broken').length;
  const add = canManage ? (
    <ButtonLink variant="primary" size="l" href="/connections/new">
      <Icon icon={Plus} size={18} />
      {t('add')}
    </ButtonLink>
  ) : undefined;

  return (
    <PageBody>
      <CheckingRefresh active={rows.some((r) => r.status === 'checking')} />
      <PageHeader
        title={t('title')}
        subtitle={[
          t('count', { count: rows.length }),
          ...(broken ? [t('brokenCount', { count: broken })] : []),
          t('keysNote'),
        ].join(' · ')}
        actions={add}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Plug} title={t('emptyTitle')} action={add}>
          {t('emptyBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...rows]
            .sort((a, b) => ORDER.indexOf(a.connectorId) - ORDER.indexOf(b.connectorId))
            .map((c) => {
              const m = manifestFor(c.connectorId);
              return m ? (
                <ConnectionCard key={c.id} c={c} manifest={m} canManage={canManage} />
              ) : null;
            })}
        </div>
      )}
    </PageBody>
  );
}
