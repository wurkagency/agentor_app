import { CATALOGUE, manifestFor } from '@agentor/connectors';
import { listConnections } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { env } from '@/server/env';
import { db } from '@/server/infra';
import { Catalogue, type CatalogueItem } from './catalogue';
import { CatalogueMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('add') };
}

/** Systems whose own key flow replaces pasting keys in live mode (PLAN-INTEGRATIONS §4.1). */
const LIVE_KEY_FLOW = new Set(['woocommerce']);

/** Tilføj forbindelse (D9-Katalog): 24 systems in 5 groups (D9 plus Odoo). */
export default async function CataloguePage() {
  const ctx = await requireRole(['owner', 'admin', 'developer']);
  const rows = await listConnections(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  const t = await getTranslations('connections');
  const live = env().CONNECTOR_MODE === 'live';
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
          : {
              type: 'key' as const,
              fields: m.auth.fields,
              webhook: Boolean(m.webhook),
              ...(live && LIVE_KEY_FLOW.has(m.id)
                ? { live: { keyFlow: true, autoWebhook: Boolean(m.webhook) } }
                : {}),
            },
    };
  });
  const desktop = (
    <PageBody>
      <PageHeader eyebrow={t('title')} title={t('add')} subtitle={t('catalogueIntro')} />
      <Catalogue items={items} />
    </PageBody>
  );
  return <Responsive desktop={desktop} mobile={<CatalogueMobile items={items} />} />;
}
