import { CATALOGUE, manifestFor } from '@agentor/connectors';
import { getOnboardingState, listLookups } from '@agentor/db';
import type { OnboardingConnection } from '@/app/(signup)/onboarding/actions';
import { connectionMap } from '@/server/flows';
import { db } from '@/server/infra';
import type { ConnectOption } from './connect-step';

/** OB1/OB2's tiles in the boards' order (layout); names, logos and availability are catalogue data. */
const FEATURED: Record<'webshop' | 'erp', string[]> = {
  webshop: ['woocommerce', 'shopify', 'magento', 'prestashop'],
  erp: ['dinero', 'economic', 'billy', 'fortnox'],
};

export function connectOption(id: string): ConnectOption | null {
  const c = CATALOGUE.find((x) => x.id === id);
  if (!c) return null;
  const m = manifestFor(id);
  return {
    id,
    name: c.name,
    logoUrl: c.logo ?? undefined,
    soon: !c.available,
    needsUrl: m?.auth.type !== 'oauth2' && !!m?.auth.fields.some((f) => f.type === 'url'),
  };
}

/** The category's systems: the one chosen on SU3 first, then the boards' order, then the rest. */
export function optionsFor(category: 'webshop' | 'erp', chosen: readonly string[]) {
  const ids = CATALOGUE.filter((c) => c.category === category).map((c) => c.id);
  const first = chosen.find((id) => ids.includes(id));
  const order = [...(first ? [first] : []), ...FEATURED[category], ...ids];
  return [...new Set(order)]
    .filter((id) => ids.includes(id))
    .map(connectOption)
    .filter((o): o is ConnectOption => !!o);
}

export async function onboardingData(ctx: { tenantId: string; userId: string }) {
  const [state, conns, lookups] = await Promise.all([
    getOnboardingState(db(), ctx),
    connectionMap(ctx.tenantId, ctx.userId),
    listLookups(db(), ctx),
  ]);
  const chosen = state?.chosenConnectors ?? [];
  const connections: OnboardingConnection[] = [...conns.values()].map((x) => ({
    id: x.id,
    connectorId: x.connectorId,
    category: manifestFor(x.connectorId)?.category ?? 'other',
    name: x.name,
    status: x.status as OnboardingConnection['status'],
    accounts: !!lookups[x.id]?.accounts?.length,
    counts: x.recordCounts ?? null,
  }));
  const pick = (cat: string) => {
    const connected = connections.find((c) => c.category === cat && c.status !== 'broken');
    const id =
      connected?.connectorId ??
      chosen.find(
        (c) =>
          manifestFor(c)?.category === cat || CATALOGUE.find((x) => x.id === c)?.category === cat,
      );
    return id ? connectOption(id) : null;
  };
  const later = chosen.find((c) => {
    const cat = CATALOGUE.find((x) => x.id === c)?.category;
    return cat === 'crm' || cat === 'marketing';
  });
  return {
    state,
    chosen,
    connections,
    diagram: {
      source: pick('webshop'),
      erp: pick('erp'),
      later: later ? connectOption(later) : null,
    },
  };
}
