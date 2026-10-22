import { manifestFor, type ConnectorManifest, type LookupOption } from '@agentor/connectors';
import { destinations, sourceNode, type FlowDefinition, type Route } from './definition.js';

/**
 * Continuous validation (produktspecifikation §5.4): every finding points at a route and field
 * so the editor can jump to it. Messages are built from code + params in the UI's language.
 */

export interface Finding {
  severity: 'error' | 'warning';
  code:
    | 'NO_SOURCE'
    | 'NO_DESTINATION'
    | 'TOO_MANY_DESTINATIONS'
    | 'UNKNOWN_CONNECTION'
    | 'CONNECTION_BROKEN'
    | 'PORT_UNSUPPORTED'
    | 'MODE_UNSUPPORTED'
    | 'MAPPING_REQUIRED'
    | 'ACCOUNT_NOT_FOUND'
    | 'ROUTE_IN_TEST';
  routeId?: string;
  nodeId?: string;
  /** Where in the inspector: "mapping.accounts.euB2b", "general.mode". */
  path?: string;
  params?: Record<string, string | number>;
}

export interface ValidationContext {
  /** connectionId → connector id and status. */
  connections: Record<
    string,
    { connectorId: string; status: 'ok' | 'broken' | 'checking'; name: string }
  >;
  /** connectionId → live lookup lists (chart of accounts etc.), when fetched. */
  lookups: Record<string, Partial<Record<'accounts' | 'vatCodes' | 'templates', LookupOption[]>>>;
  /** Plan limit, null = unlimited. */
  maxDestinations: number | null;
}

function manifestOfNode(def: FlowDefinition, ctx: ValidationContext, nodeId: string) {
  const node = def.nodes.find((n) => n.id === nodeId);
  const conn = node ? ctx.connections[node.connectionId] : undefined;
  return { node, conn, manifest: conn ? manifestFor(conn.connectorId) : null };
}

function portLabel(m: ConnectorManifest | null, entity: string, dir: 'outputs' | 'inputs') {
  return m?.[dir].find((p) => p.entity === entity)?.label ?? entity;
}

/** "Ordrer → Dinero Fakturaer" for findings and lists. */
export function routeLabel(def: FlowDefinition, ctx: ValidationContext, r: Route): string {
  const src = manifestOfNode(def, ctx, r.from).manifest;
  const dst = manifestOfNode(def, ctx, r.to).manifest;
  return `${portLabel(src, r.entity, 'outputs')} → ${dst?.name ?? ''} ${portLabel(dst, r.targetEntity, 'inputs')}`.trim();
}

export function validateDefinition(def: FlowDefinition, ctx: ValidationContext): Finding[] {
  const out: Finding[] = [];
  const src = sourceNode(def);
  if (!src) out.push({ severity: 'error', code: 'NO_SOURCE' });
  const dests = destinations(def);
  if (dests.length === 0) out.push({ severity: 'error', code: 'NO_DESTINATION' });
  if (ctx.maxDestinations !== null && dests.length > ctx.maxDestinations)
    out.push({
      severity: 'error',
      code: 'TOO_MANY_DESTINATIONS',
      params: { max: ctx.maxDestinations },
    });

  for (const n of def.nodes) {
    const conn = ctx.connections[n.connectionId];
    if (!conn) out.push({ severity: 'error', code: 'UNKNOWN_CONNECTION', nodeId: n.id });
    else if (conn.status === 'broken')
      out.push({
        severity: 'error',
        code: 'CONNECTION_BROKEN',
        nodeId: n.id,
        params: { name: manifestFor(conn.connectorId)?.name ?? conn.connectorId },
      });
  }

  for (const r of def.routes) {
    const from = manifestOfNode(def, ctx, r.from);
    const to = manifestOfNode(def, ctx, r.to);
    const label = routeLabel(def, ctx, r);
    const outPort = from.manifest?.outputs.find((p) => p.entity === r.entity);
    const inPort = to.manifest?.inputs.find((p) => p.entity === r.targetEntity);
    if (from.node?.role !== 'source' || to.node?.role !== 'destination' || !outPort || !inPort) {
      out.push({
        severity: 'error',
        code: 'PORT_UNSUPPORTED',
        routeId: r.id,
        params: { route: label },
      });
      continue;
    }
    const writeMode = r.mode === 'test' ? 'dry_run' : r.mode;
    if (inPort.modes && !inPort.modes.includes(writeMode))
      out.push({
        severity: 'error',
        code: 'MODE_UNSUPPORTED',
        routeId: r.id,
        path: 'general.mode',
        params: { route: label, mode: r.mode },
      });

    // Guided mapping: required fields, and accounts that must exist in the destination.
    const groups = to.manifest?.mapping?.[r.targetEntity] ?? [];
    const lookups = to.node ? ctx.lookups[to.node.connectionId] : undefined;
    for (const g of groups)
      for (const f of g.fields) {
        const v = r.mapping[f.key];
        const path = `mapping.${f.key}`;
        if (!v) {
          if (f.required)
            out.push({
              severity: 'error',
              code: 'MAPPING_REQUIRED',
              routeId: r.id,
              path,
              params: { route: label, field: f.label },
            });
          continue;
        }
        const list = f.lookup ? lookups?.[f.lookup] : undefined;
        if (list && !list.some((o) => o.value === v))
          out.push({
            severity: 'error',
            code: 'ACCOUNT_NOT_FOUND',
            routeId: r.id,
            path,
            params: { route: label, field: f.label, value: v, system: to.manifest?.name ?? '' },
          });
      }
    for (const row of r.categoryAccounts) {
      const list = lookups?.accounts;
      if (list && !list.some((o) => o.value === row.account))
        out.push({
          severity: 'error',
          code: 'ACCOUNT_NOT_FOUND',
          routeId: r.id,
          path: 'mapping.categoryAccounts',
          params: {
            route: label,
            field: row.product ?? row.category,
            value: row.account,
            system: to.manifest?.name ?? '',
          },
        });
    }

    if (r.mode === 'test' && !r.paused)
      out.push({
        severity: 'warning',
        code: 'ROUTE_IN_TEST',
        routeId: r.id,
        path: 'general.mode',
        params: { route: label, system: to.manifest?.name ?? '' },
      });
  }
  return out;
}

export const hasErrors = (f: Finding[]) => f.some((x) => x.severity === 'error');
