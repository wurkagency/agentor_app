import { CATALOGUE, manifestFor } from '@agentor/connectors';
import { listConnections } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { Catalogue, type CatalogueItem } from './catalogue';

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('add') };
}

/** Tilføj forbindelse (D9-Katalog): 23 systems in 5 groups. */
export default async function CataloguePage() {
  const ctx = await requireRole(['owner', 'admin', 'developer']);
  const rows = await listConnections(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  const t = await getTranslations('connections');
  const items: CatalogueItem[] = CATALOGUE.map((c) => {
    const m = manifestFor(c.id);
    const mine = rows.filter((r) => r.connectorId === c.id);
    return {
      id: c.id,
      name: c.name,
      subtitle: mine.length
        ? mine
            .map(
              (r) =>
                r.name + (r.status === 'broken' ? ` · ${t('status.broken').toLowerCase()}` : ''),
            )
            .join(', ')
        : c.subtitle,
      category: c.category,
      logo: c.logo,
      available: c.available,
      connected: mine.length > 0,
      auth: !m
        ? null
        : m.auth.type === 'oauth2'
          ? { type: 'oauth' as const, provider: m.auth.provider, scopes: m.auth.scopes }
          : { type: 'key' as const, fields: m.auth.fields, webhook: Boolean(m.webhook) },
    };
  });
  return (
    <PageBody>
      <PageHeader eyebrow={t('title')} title={t('add')} subtitle={t('catalogueIntro')} />
      <Catalogue items={items} />
    </PageBody>
  );
}
