import { manifestFor, type ConnectorManifest, type Entity } from '@agentor/connectors';
import type { Finding, FlowDefinition, Route, RouteChange } from '@agentor/flows';

/**
 * Client-safe helpers for the flow editor: what to call things (each system's own words, from
 * the manifests) and how findings and changes read in the UI.
 */

export interface EditorConnection {
  id: string;
  connectorId: string;
  name: string;
  status: 'ok' | 'broken' | 'checking';
}

export type ConnMap = Record<string, EditorConnection>;

export function nodeManifest(
  def: FlowDefinition,
  conns: ConnMap,
  nodeId: string,
): ConnectorManifest | null {
  const n = def.nodes.find((x) => x.id === nodeId);
  const c = n ? conns[n.connectionId] : undefined;
  return c ? manifestFor(c.connectorId) : null;
}

export function portLabel(m: ConnectorManifest | null, entity: Entity, dir: 'outputs' | 'inputs') {
  return m?.[dir].find((p) => p.entity === entity)?.label ?? entity;
}

/** "Ordrer → Dinero Fakturaer". */
export function routeLabel(def: FlowDefinition, conns: ConnMap, r: Route, short = false): string {
  const src = nodeManifest(def, conns, r.from);
  const dst = nodeManifest(def, conns, r.to);
  const target = portLabel(dst, r.targetEntity, 'inputs');
  return `${portLabel(src, r.entity, 'outputs')} → ${short ? target : `${dst?.name ?? ''} ${target}`.trim()}`;
}

export function fieldLabel(def: FlowDefinition, conns: ConnMap, r: Route, key: string): string {
  const m = nodeManifest(def, conns, r.to);
  return (
    Object.values(m?.mapping ?? {})
      .flat()
      .flatMap((g) => g?.fields ?? [])
      .find((f) => f.key === key)?.label ?? key
  );
}

/** Where a finding lives: "Mapping · Konti" / "Generelt · Tilstand". */
export function findingPlace(
  t: (k: string) => string,
  def: FlowDefinition,
  conns: ConnMap,
  f: Finding,
): string {
  const r = def.routes.find((x) => x.id === f.routeId);
  const route = r ? routeLabel(def, conns, r) : '';
  const tab = f.path?.startsWith('mapping')
    ? t('tabs.mapping')
    : f.path?.startsWith('general')
      ? t('tabs.general')
      : '';
  const group = f.path?.startsWith('mapping.accounts')
    ? t('accounts')
    : f.path === 'general.mode'
      ? t('mode')
      : '';
  return [t(`severity.${f.severity}`), route, tab, group].filter(Boolean).join(' · ');
}

let counter = 0;
/** Route ids are stable keys in the definition ([a-z0-9-]). */
export function newRouteId(entity: string, targetConnector: string, existing: Route[]): string {
  const base = `${entity.toLowerCase()}-${targetConnector}`.replace(/[^a-z0-9-]/g, '').slice(0, 30);
  let id = base;
  while (existing.some((r) => r.id === id)) id = `${base}-${++counter}`;
  return id;
}

export function newNodeId(connectorId: string, existing: { id: string }[]): string {
  let id = connectorId.replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'node';
  let n = 1;
  while (existing.some((x) => x.id === id)) id = `${connectorId}-${++n}`;
  return id;
}

export interface ChangeLine {
  routeId: string;
  title: string;
  detail: string;
  badge: 'draft' | 'live' | 'test' | null;
  modeFrom?: string;
  modeTo?: string;
}

/** The publish dialog's change list (D5-GaaLive), in the customer's words. */
export function describeChanges(
  t: (k: string, p?: Record<string, string | number>) => string,
  before: FlowDefinition | null,
  after: FlowDefinition,
  changes: RouteChange[],
  conns: ConnMap,
  lookupLabel: (routeId: string, value: string | null) => string,
): ChangeLine[] {
  return changes.map((c) => {
    const r =
      after.routes.find((x) => x.id === c.routeId) ??
      before?.routes.find((x) => x.id === c.routeId);
    const def = after.routes.some((x) => x.id === c.routeId) ? after : (before ?? after);
    const label = r ? routeLabel(def, conns, r) : c.routeId;
    switch (c.kind) {
      case 'mapping':
        return {
          routeId: c.routeId,
          title: label,
          detail: t('change.mapping', {
            field: r ? fieldLabel(def, conns, r, c.field ?? '') : (c.field ?? ''),
            before: lookupLabel(c.routeId, (c.before as string | null) ?? null),
            after: lookupLabel(c.routeId, (c.after as string | null) ?? null),
          }),
          badge: 'draft',
        };
      case 'mode':
        return {
          routeId: c.routeId,
          title: label,
          detail: t('change.mode', {
            before: t(`modes.${c.before}`),
            after: t(`modes.${c.after}`),
          }),
          badge: null,
          modeFrom: String(c.before),
          modeTo: String(c.after),
        };
      case 'filters':
        return {
          routeId: c.routeId,
          title: t('change.filtersTitle', { route: label }),
          detail: t('change.filters', {
            rules: describeFilters(t, (c.after as Route['filters']) ?? []) || t('change.noFilters'),
          }),
          badge: 'draft',
        };
      case 'added':
        return { routeId: c.routeId, title: label, detail: t('change.added'), badge: 'draft' };
      case 'removed':
        return { routeId: c.routeId, title: label, detail: t('change.removed'), badge: 'draft' };
      default:
        return { routeId: c.routeId, title: label, detail: t('change.settings'), badge: 'draft' };
    }
  });
}

export function describeFilters(
  t: (k: string, p?: Record<string, string | number>) => string,
  rules: Route['filters'],
): string {
  const groups = [...new Set(rules.map((r) => r.group ?? 0))].sort();
  const sentence = (rs: Route['filters']) =>
    rs
      .map((r) =>
        t(`filter.sentence.${r.field}`, {
          op: t(`filter.ops.${r.op}`),
          value: String(r.value),
        }),
      )
      .join(` ${t('filter.and')} `);
  if (groups.length <= 1) return sentence(rules);
  // OR groups: "(a og b) eller (c)".
  return groups
    .map((g) => `(${sentence(rules.filter((r) => (r.group ?? 0) === g))})`)
    .join(` ${t('filter.or')} `);
}

/** Routes that write invoices to an ERP: the publish dialog asks how (D5 "Som kladde"). */
export function erpOrderRoutes(def: FlowDefinition, conns: ConnMap): Route[] {
  return def.routes.filter(
    (r) =>
      r.entity === 'order' &&
      r.targetEntity === 'order' &&
      nodeManifest(def, conns, r.to)?.category === 'erp',
  );
}
