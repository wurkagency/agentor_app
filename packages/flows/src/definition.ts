import { ENTITIES } from '@agentor/connectors';
import { z } from 'zod';

/**
 * A flow version's definition (produktspecifikation §4.2, §5): one source node, 1..N destination
 * nodes and routes from source entities to destination entities. Stored as JSON in
 * flow_versions; settings and mapping use the manifest's stable keys (§4.5).
 */

export const ROUTE_MODES = ['test', 'draft', 'live'] as const;
/** Test writes nothing; Kladde writes drafts (e.g. Dinero invoice drafts); Live books. */
export type RouteMode = (typeof ROUTE_MODES)[number];

const entity = z.enum(ENTITIES);

export const filterRuleSchema = z.object({
  field: z.enum(['total', 'status', 'country', 'customerKind']),
  op: z.enum(['gt', 'gte', 'lt', 'eq', 'neq']),
  value: z.union([z.string().max(64), z.number()]),
  /** OR groups: a record passes when every rule of at least one group passes. */
  group: z.number().int().min(0).max(9).default(0),
});
export type FilterRule = z.infer<typeof filterRuleSchema>;

export const routeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  from: z.string(),
  to: z.string(),
  entity,
  targetEntity: entity,
  mode: z.enum(ROUTE_MODES),
  paused: z.boolean().default(false),
  pausedBy: z.string().max(120).nullish(),
  pausedAt: z.string().nullish(),
  /** Manifest route settings by stable key, e.g. "invoice.bookAutomatically". */
  settings: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).default({}),
  /** Guided mapping by stable key, e.g. "accounts.euB2b" → "1015". */
  mapping: z.record(z.string(), z.string().max(64)).default({}),
  /** Category → account rows (n+1 mapping, §4.5); product exceptions win. */
  categoryAccounts: z
    .array(
      z.object({
        category: z.string().max(80),
        account: z.string().max(32),
        product: z.string().max(80).nullish(),
      }),
    )
    .default([]),
  filters: z.array(filterRuleSchema).default([]),
  /** Developer mapping: JSONata expression per target field, e.g. "customer.name". */
  expressions: z
    .record(z.string().regex(/^[A-Za-z][\w.]{0,79}$/), z.string().max(2000))
    .default({}),
  /** Update existing records in the destination (matched via the cross-reference). */
  updateExisting: z.boolean().default(true),
});
export type Route = z.infer<typeof routeSchema>;

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  role: z.enum(['source', 'destination']),
  connectionId: z.uuid(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type FlowNode = z.infer<typeof nodeSchema>;

export const definitionSchema = z.object({
  nodes: z.array(nodeSchema).max(32),
  routes: z.array(routeSchema).max(64),
  /** Default mode for new routes (Kladde/Live at flow level, PLAN Q16). */
  defaultMode: z.enum(ROUTE_MODES).default('test'),
  /** Polling interval in minutes; bounded by the plan (D7 "Kører hvert 5. minut"). */
  pollMinutes: z.number().int().min(1).max(1440).default(5),
});
export type FlowDefinition = z.infer<typeof definitionSchema>;

export function parseDefinition(raw: unknown): FlowDefinition {
  return definitionSchema.parse(raw);
}

export function sourceNode(def: FlowDefinition): FlowNode | undefined {
  return def.nodes.find((n) => n.role === 'source');
}

export function destinations(def: FlowDefinition): FlowNode[] {
  return def.nodes.filter((n) => n.role === 'destination');
}

/** Short human list of what changed between two versions (publish dialog, D5-GaaLive). */
export interface RouteChange {
  routeId: string;
  kind: 'added' | 'removed' | 'mode' | 'mapping' | 'filters' | 'settings' | 'paused';
  field?: string;
  before?: unknown;
  after?: unknown;
}

export function diffDefinitions(
  before: FlowDefinition | null,
  after: FlowDefinition,
): RouteChange[] {
  const out: RouteChange[] = [];
  const prev = new Map((before?.routes ?? []).map((r) => [r.id, r]));
  for (const r of after.routes) {
    const p = prev.get(r.id);
    if (!p) {
      out.push({ routeId: r.id, kind: 'added' });
      continue;
    }
    if (p.mode !== r.mode) out.push({ routeId: r.id, kind: 'mode', before: p.mode, after: r.mode });
    if (p.paused !== r.paused)
      out.push({ routeId: r.id, kind: 'paused', before: p.paused, after: r.paused });
    const keys = new Set([...Object.keys(p.mapping), ...Object.keys(r.mapping)]);
    for (const k of keys)
      if (p.mapping[k] !== r.mapping[k])
        out.push({
          routeId: r.id,
          kind: 'mapping',
          field: k,
          before: p.mapping[k] ?? null,
          after: r.mapping[k] ?? null,
        });
    if (JSON.stringify(p.filters) !== JSON.stringify(r.filters))
      out.push({ routeId: r.id, kind: 'filters', before: p.filters, after: r.filters });
    if (
      JSON.stringify(p.settings) !== JSON.stringify(r.settings) ||
      JSON.stringify(p.categoryAccounts) !== JSON.stringify(r.categoryAccounts) ||
      p.updateExisting !== r.updateExisting
    )
      out.push({ routeId: r.id, kind: 'settings' });
  }
  for (const id of prev.keys())
    if (!after.routes.some((r) => r.id === id)) out.push({ routeId: id, kind: 'removed' });
  return out;
}
