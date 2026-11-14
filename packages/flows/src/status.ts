import { rollUpStatus, type Status } from '@agentor/core';
import type { FlowDefinition, Route } from './definition.js';

/**
 * Status vocabulary per route, rolled up to the flow: the worst route wins (D7 "Status rulles op:
 * den værste rute bestemmer flowets status"). Afbrudt > Fejl > Advarsel > Aktiv > Test > Pauset >
 * Kladde.
 */

export interface RouteHealth {
  /** Unresolved failed records on the route (failed and not yet succeeded on retry). */
  openFailures: number;
  /** Error rate over the period, 0..1, for the 5 % warning threshold. */
  errorRate: number;
}

export interface StatusContext {
  published: boolean;
  flowPaused: boolean;
  /** connectionId → broken? */
  brokenConnections: ReadonlySet<string>;
  health: Readonly<Record<string, RouteHealth | undefined>>;
  /** Tenant threshold (D2: 5 %), as a fraction. */
  warnErrorRate: number;
}

export function routeStatus(def: FlowDefinition, r: Route, ctx: StatusContext): Status {
  if (!ctx.published) return 'draft';
  const from = def.nodes.find((n) => n.id === r.from);
  const to = def.nodes.find((n) => n.id === r.to);
  if (
    (from && ctx.brokenConnections.has(from.connectionId)) ||
    (to && ctx.brokenConnections.has(to.connectionId))
  )
    return 'broken';
  if (ctx.flowPaused || r.paused) return 'paused';
  const h = ctx.health[r.id];
  if (h && h.openFailures > 0) return 'error';
  if (r.mode === 'test') return 'info';
  if (h && h.errorRate >= ctx.warnErrorRate) return 'warn';
  return 'ok';
}

export function flowStatus(def: FlowDefinition | null, ctx: StatusContext): Status {
  if (!def || !ctx.published) return 'draft';
  if (ctx.flowPaused) {
    // A paused flow with a broken connection still needs the customer: Afbrudt wins.
    const broken = def.nodes.some((n) => ctx.brokenConnections.has(n.connectionId));
    return broken ? 'broken' : 'paused';
  }
  return rollUpStatus(def.routes.map((r) => routeStatus(def, r, ctx)));
}

/** The flow's "Tilstand" column (D2): Live, Kladde, Test or Blandet. */
export function flowMode(def: FlowDefinition | null): 'live' | 'test' | 'draft' | 'mixed' | null {
  if (!def || def.routes.length === 0) return null;
  const modes = new Set(def.routes.map((r) => r.mode));
  if (modes.size > 1) return 'mixed';
  return [...modes][0]!;
}
