// Client-safe: shared by the filter bar and the page/export. No server imports.
export const OUTCOME_FILTERS = ['failed', 'ok', 'skipped', 'test'] as const;
export const ENTITY_FILTERS = ['order', 'creditNote', 'customer', 'product', 'stock'] as const;
export const ACTIVITY_PERIODS = { today: 1, '7d': 7, '30d': 30 } as const;

export interface ActivityQuery {
  flow?: string | undefined;
  entity?: string | undefined;
  outcome?: string | undefined;
  period?: string | undefined;
  q?: string | undefined;
  before?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toActivityFilter(q: ActivityQuery, limit = 50) {
  const days = ACTIVITY_PERIODS[(q.period as keyof typeof ACTIVITY_PERIODS) ?? 'today'] ?? 1;
  const before = q.before ? new Date(q.before) : undefined;
  return {
    flowId: q.flow && UUID.test(q.flow) ? q.flow : undefined,
    entity: (ENTITY_FILTERS as readonly string[]).includes(q.entity ?? '') ? q.entity : undefined,
    outcome: (OUTCOME_FILTERS as readonly string[]).includes(q.outcome ?? '')
      ? (q.outcome as (typeof OUTCOME_FILTERS)[number])
      : undefined,
    since: new Date(Date.now() - days * 86_400_000),
    q: q.q?.slice(0, 64) || undefined,
    before: before && !Number.isNaN(before.getTime()) ? before : undefined,
    limit,
  };
}
