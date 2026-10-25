import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { LookupId, WriteMode } from './manifest.js';
import { manifestFor } from './manifests/index.js';
import { ENTITIES, type Entity, type EntityRecord } from './model.js';
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
  /** For accounts: the VAT code the account books with (Dinero `VatCode`, e.g. "U25"). */
  vatCode?: string;
}

export interface FetchOptions {
  limit: number;
  /**
   * Only records changed at or after this instant (ISO 8601). The engine passes its cursor
   * minus a 2-minute overlap; duplicates are dropped by the idempotency key.
   */
  since?: string | null;
}

export interface WriteOptions {
  mode: WriteMode;
  existingId?: string | null;
  /**
   * Destination ids of the record's dependencies, resolved by the engine before the write
   * (manifest `dependencies`), e.g. `{ 'customer:c-901': '412', 'product:p-1': '88' }`.
   */
  refs?: Record<string, string>;
  /**
   * Target fields rendered from the route's templates (manifest `targets`), e.g.
   * `{ 'invoice.description': 'Ordre 10447' }`. Line fields are per record line, in order.
   */
  fields?: Record<string, string>;
  lineFields?: Record<string, string>[];
}

/** What a verified webhook says changed. */
export interface WebhookChange {
  entity: Entity;
  sourceIds: string[];
  /** The sender's delivery id, used to drop duplicate deliveries. */
  deliveryId: string | null;
}

export interface ConnectorAdapter {
  readonly connectorId: string;
  test(): Promise<TestResult>;
  fetch<E extends Entity>(entity: E, opts: FetchOptions): Promise<EntityRecord[E][]>;
  /** One record by its source id; null when it no longer exists. */
  get<E extends Entity>(entity: E, sourceId: string): Promise<EntityRecord[E] | null>;
  lookup(list: LookupId): Promise<LookupOption[]>;
  /**
   * How many records of an entity the account holds, for the entities in the manifest's `counts`;
   * null when the system cannot say. Optional: a live client adds it when its API supports it.
   */
  count?(entity: Entity): Promise<number | null>;
  write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: WriteOptions,
  ): Promise<WriteResult>;
  /** Reads a verified webhook body; null when it is not about a synced entity. */
  parseWebhook(rawBody: string, headers: Record<string, string>): WebhookChange | null;
}

/**
 * Why a write failed, so the engine knows what to do (produktspecifikation §4.1):
 * - `invalid`: the destination rejected the data (4xx validation). Never retried; "Kræver
 *   handling".
 * - `transient`: timeouts, 5xx. Retried with backoff.
 * - `rate_limited`: 429. Retried after `retryAfterMs`.
 * - `unauthorized`: the connection's access is gone. Records wait for the connection.
 */
export class WriteError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'transient' | 'rate_limited' | 'unauthorized',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

/**
 * The version of a source record for the idempotency key: its change time when the system has
 * one, otherwise a hash of its content, so an unchanged record is never processed twice.
 */
export function sourceVersion(record: unknown): string {
  const r = record as { updatedAt?: unknown; modifiedAt?: unknown };
  const stamp = r.updatedAt ?? r.modifiedAt;
  if (typeof stamp === 'string' && stamp) return stamp;
  return `h:${createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 24)}`;
}

/** When a source record last changed, if the system says so (cursor and echo checks). */
export function changedAt(record: unknown): string | null {
  const r = record as { updatedAt?: unknown; createdAt?: unknown };
  const v = r.updatedAt ?? r.createdAt;
  return typeof v === 'string' ? v : null;
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

  private all<E extends Entity>(entity: E): EntityRecord[E][] {
    const source: Partial<Record<Entity, unknown[]>> = {
      order: ORDERS,
      customer: CUSTOMERS,
      product: PRODUCTS,
      creditNote: [],
      stock: [],
    };
    return (source[entity] ?? []) as EntityRecord[E][];
  }

  async fetch<E extends Entity>(entity: E, opts: FetchOptions) {
    const since = opts.since ? Date.parse(opts.since) : null;
    return this.all(entity)
      .filter((r) => {
        if (since === null) return true;
        const at = changedAt(r);
        return at === null || Date.parse(at) >= since;
      })
      .slice(0, opts.limit);
  }

  async get<E extends Entity>(entity: E, sourceId: string) {
    return this.all(entity).find((r) => (r as { sourceId: string }).sourceId === sourceId) ?? null;
  }

  /** Mock webhooks: `{"entity":"order","ids":["o-10447"],"deliveryId":"…"}`. */
  parseWebhook(rawBody: string): WebhookChange | null {
    try {
      const b = JSON.parse(rawBody) as { entity?: string; ids?: unknown; deliveryId?: unknown };
      const entity = ENTITIES.find((e) => e === b.entity);
      if (!entity || !Array.isArray(b.ids)) return null;
      return {
        entity,
        sourceIds: b.ids.filter((x): x is string => typeof x === 'string').slice(0, 500),
        deliveryId: typeof b.deliveryId === 'string' ? b.deliveryId.slice(0, 200) : null,
      };
    } catch {
      return null;
    }
  }

  async count(entity: Entity) {
    if (!manifestFor(this.ctx.connectorId)?.counts?.includes(entity)) return null;
    return this.all(entity).length;
  }

  async lookup(list: LookupId): Promise<LookupOption[]> {
    if (list === 'accounts') return DINERO_ACCOUNTS;
    if (list === 'vatCodes')
      return [
        { value: 'I25', label: 'Salgsmoms 25 %' },
        { value: 'IEUV', label: 'EU-salg af varer' },
      ];
    if (list === 'templates') return [{ value: 'standard', label: 'Standard' }];
    return [];
  }

  async write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: WriteOptions,
  ): Promise<WriteResult> {
    const action = opts.existingId ? 'update' : 'create';
    // Tests can make the mock fail a write: credentials `mockFail` = "transient:o-10446,invalid:o-1".
    const fail = (this.ctx.credentials.mockFail ?? '')
      .split(',')
      .map((x) => x.split(':'))
      .find(([, id]) => id === (record as { sourceId: string }).sourceId);
    if (fail && opts.mode !== 'dry_run') {
      const kind = fail[0] as WriteError['kind'];
      throw new WriteError(`mock ${kind}`, kind, kind === 'rate_limited' ? 1000 : undefined);
    }
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

/** Counts for the manifest's countable entities; a failed or missing count is left out. */
export async function countRecords(
  adapter: ConnectorAdapter,
  entities: readonly Entity[] = [],
): Promise<Partial<Record<Entity, number>>> {
  const out: Partial<Record<Entity, number>> = {};
  if (!adapter.count) return out;
  for (const e of entities) {
    const n = await adapter.count(e).catch(() => null);
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[e] = n;
  }
  return out;
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
