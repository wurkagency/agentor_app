import { adapterFor, type AdapterContext, type ConnectorAdapter } from '../adapter.js';
import { DineroAdapter, type OAuthClient } from './dinero.js';
import type { Transport } from './http.js';
import { WooAdapter } from './woocommerce.js';

/**
 * Live clients (PLAN-INTEGRATIONS-WOO-DINERO P1/P2). A separate entry point, so the browser
 * bundle that reads manifests never pulls in the network code. Only server code imports it.
 */
export interface LiveContext extends AdapterContext {
  connectionId?: string;
  transport?: Transport;
  /** OAuth client per provider, for token refresh (Dinero: Visma Connect). */
  oauth?: Partial<Record<string, OAuthClient>>;
}

export const LIVE_CONNECTORS = ['woocommerce', 'dinero'] as const;

export function hasLiveClient(connectorId: string): boolean {
  return (LIVE_CONNECTORS as readonly string[]).includes(connectorId);
}

/**
 * The adapter the worker uses: the live client when the mode is live and the connector has
 * one, otherwise the mock (or the "no live client yet" error from `adapterFor`).
 */
export function openAdapter(ctx: LiveContext): ConnectorAdapter {
  if (ctx.mode === 'live' && ctx.connectorId === 'woocommerce') return new WooAdapter(ctx);
  if (ctx.mode === 'live' && ctx.connectorId === 'dinero') {
    const { oauth, ...rest } = ctx;
    const client = oauth?.dinero;
    return new DineroAdapter({ ...rest, ...(client ? { oauth: client } : {}) });
  }
  return adapterFor(ctx);
}

export * from './dinero.js';
export * from './http.js';
export * from './woocommerce.js';
