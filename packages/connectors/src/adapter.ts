import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WriteMode } from './manifest.js';
import { manifestFor } from './manifests/index.js';
import type { Entity, EntityRecord } from './model.js';
import { CUSTOMERS, DINERO_ACCOUNTS, MOCK_ACCOUNTS, ORDERS, PRODUCTS } from './mock/fixtures.js';

/**
 * Adapter contract: everything a connector does, in the common model. The engine never talks
 * to a system any other way.
 */

export interface AccountInfo {
  id: string;
  name: string;
}

export type TestResult =
  | { ok: true; account: AccountInfo }
  | { ok: false; reason: 'unauthorized' | 'unreachable' | 'unknown'; message: string };

export interface WriteResult {
  action: 'create' | 'update' | 'skip';
  /** The record's id in the destination; null for dry runs. */
  destinationId: string | null;
}

export interface LookupOption {
  value: string;
  label: string;
}

export interface ConnectorAdapter {
  readonly connectorId: string;
  test(): Promise<TestResult>;
  fetch<E extends Entity>(entity: E, opts: { limit: number }): Promise<EntityRecord[E][]>;
  lookup(list: 'accounts' | 'vatCodes' | 'templates'): Promise<LookupOption[]>;
  write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: { mode: WriteMode; existingId?: string | null },
  ): Promise<WriteResult>;
}

export interface AdapterContext {
  connectorId: string;
  /** Opened by the worker from the key box; never logged. */
  credentials: Record<string, string>;
  /** `mock` until a connector's live client ships (produktspecifikation §13, Fase 1). */
  mode: 'mock' | 'live';
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'UNKNOWN_CONNECTOR' | 'NOT_AVAILABLE' | 'UNAUTHORIZED',
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/**
 * Deterministic stand-in for a connector. Credentials containing "invalid" or "revoked" fail the
 * connection test, so broken connections can be demonstrated and tested.
 */
class MockAdapter implements ConnectorAdapter {
  constructor(private readonly ctx: AdapterContext) {}
  get connectorId() {
    return this.ctx.connectorId;
  }

  async test(): Promise<TestResult> {
    const values = Object.values(this.ctx.credentials).join(' ');
    if (/invalid|revoked/i.test(values))
      return { ok: false, reason: 'unauthorized', message: 'Adgangen blev afvist.' };
    const account = MOCK_ACCOUNTS[this.ctx.connectorId] ?? { id: 'mock', name: 'Testkonto' };
    const base = this.ctx.credentials.baseUrl;
    return {
      ok: true,
      account: base ? { id: new URL(base).host, name: new URL(base).host } : account,
    };
  }

  async fetch<E extends Entity>(entity: E, opts: { limit: number }) {
    const source: Partial<Record<Entity, unknown[]>> = {
      order: ORDERS,
      customer: CUSTOMERS,
      product: PRODUCTS,
      creditNote: [],
      stock: [],
    };
    return ((source[entity] ?? []) as EntityRecord[E][]).slice(0, opts.limit);
  }

  async lookup(list: 'accounts' | 'vatCodes' | 'templates') {
    if (list === 'accounts') return DINERO_ACCOUNTS;
    if (list === 'vatCodes')
      return [
        { value: 'I25', label: 'Salgsmoms 25 %' },
        { value: 'IEUV', label: 'EU-salg af varer' },
      ];
    return [{ value: 'standard', label: 'Standard' }];
  }

  async write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: { mode: WriteMode; existingId?: string | null },
  ): Promise<WriteResult> {
    const action = opts.existingId ? 'update' : 'create';
    if (opts.mode === 'dry_run') return { action, destinationId: null };
    const key = (record as { sourceId: string }).sourceId;
    return {
      action,
      destinationId: opts.existingId ?? `${this.ctx.connectorId}-${entity}-${key}`,
    };
  }
}

export function adapterFor(ctx: AdapterContext): ConnectorAdapter {
  if (!manifestFor(ctx.connectorId))
    throw new AdapterError('unknown connector', 'UNKNOWN_CONNECTOR');
  if (ctx.mode === 'live')
    throw new AdapterError(`${ctx.connectorId} has no live client yet`, 'NOT_AVAILABLE');
  return new MockAdapter(ctx);
}

/** Webhook signature as WooCommerce and Shopify send it: base64 HMAC-SHA256 of the raw body. */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
