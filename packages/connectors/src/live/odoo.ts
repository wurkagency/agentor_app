import {
  WriteError,
  type AdapterContext,
  type ConnectorAdapter,
  type FetchOptions,
  type LookupOption,
  type TestResult,
  type WebhookChange,
  type WriteResult,
} from '../adapter.js';
import type { LookupId } from '../manifest.js';
import type { Entity, EntityRecord, InvoiceStatus, Shipment, Stock } from '../model.js';
import { HttpError, ore, safeTransport, toWriteError, type Transport } from './http.js';

/**
 * Odoo live client (PLAN-INTEGRATIONS-WOO-ODOO16 §4–5): the external API over JSON-RPC
 * (`/jsonrpc`, services `common` and `object`), signed in with database, login and API key.
 * Odoo 16 has no webhooks, so every source port is a cursor poll on `write_date`. Field and
 * method names that differ between major versions live in a profile (§3.3).
 */

type Json = Record<string, unknown>;
/** An Odoo search domain: `[['state', '=', 'done'], ['write_date', '>=', '…']]`. */
type Domain = unknown[];
type Meta = NonNullable<LookupOption['meta']>;
/** A many2one value as Odoo reads it: `[id, "Name"]`, or false when empty. */
type Many2one = [number, string] | false;

export interface OdooCredentials {
  baseUrl: string;
  database: string;
  login: string;
  apiKey: string;
}

/* ---- Version profiles (§3.3) ------------------------------------------------------------------- */

export interface OdooProfile {
  major: number;
  /** Done quantity on a stock move: `quantity_done` on 16 (`quantity` from 17). */
  moveDoneQty: string;
  /** The field and value that mark a storable product: `detailed_type` = 'product' on 16. */
  productType: { field: string; storable: string };
  /** Whether automated actions can send webhooks (17+). */
  webhooks: boolean;
}

export const ODOO_PROFILES: Record<number, OdooProfile> = {
  16: {
    major: 16,
    moveDoneQty: 'quantity_done',
    productType: { field: 'detailed_type', storable: 'product' },
    webhooks: false,
  },
};

/** The major version from `server_version` ("16.0+e", "saas~16.3+e", "16.0-20251010"). */
export function odooMajor(serverVersion: string): number | null {
  const m = /(\d+)\.\d+/.exec(serverVersion);
  return m ? Number(m[1]) : null;
}

/* ---- Values ------------------------------------------------------------------------------------ */

/** Odoo datetimes are UTC without a zone ("2026-10-25 12:00:00"); false means empty. */
export function odooTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(`${v.replace(' ', 'T')}${v.length > 10 ? 'Z' : ''}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** An ISO instant in Odoo's domain format. */
export function toOdooTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const m2oId = (v: unknown): number | null => (Array.isArray(v) ? Number(v[0]) : null);
const m2oName = (v: unknown): string | null => (Array.isArray(v) ? String(v[1]) : null);

/* ---- Client ------------------------------------------------------------------------------------ */

interface RpcError {
  code?: number;
  message?: string;
  data?: { name?: string; message?: string };
}

const CONCURRENCY = /could not serialize|deadlock detected|lock not available|concurrent update/i;

/**
 * Odoo's exception classes in engine terms (produktspecifikation §4.1). A refused login or a
 * missing access right waits for the connection; data Odoo rejects is never retried; database
 * concurrency failures are.
 */
export function odooError(err: RpcError): WriteError {
  const name = err.data?.name ?? '';
  const message = (err.data?.message ?? err.message ?? 'Odoo error').slice(0, 500);
  const short = name.split('.').at(-1) || 'OdooError';
  const full = `${short}: ${message}`;
  if (/AccessDenied|AccessError|SessionExpired/.test(name))
    return new WriteError(full, 'unauthorized');
  if (CONCURRENCY.test(message)) return new WriteError(full, 'transient');
  return new WriteError(full, 'invalid');
}

export class OdooClient {
  private uid: number | null = null;
  private seq = 0;

  constructor(
    private readonly creds: OdooCredentials,
    private readonly transport: Transport = safeTransport,
    /** Sent with every model call: company, language (§1 O15). */
    private readonly context: Json = {},
  ) {}

  private get endpoint() {
    return `${this.creds.baseUrl.replace(/\/+$/, '')}/jsonrpc`;
  }

  async rpc<T>(service: 'common' | 'object', method: string, args: unknown[]): Promise<T> {
    const res = await this.transport(this.endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: ++this.seq,
      }),
    });
    if (res.status >= 400) throw new HttpError(res.status, res.body.slice(0, 300));
    let out: { result?: T; error?: RpcError };
    try {
      out = JSON.parse(res.body) as { result?: T; error?: RpcError };
    } catch {
      // A proxy or a login page in front of Odoo: not something to retry blindly.
      throw new HttpError(502, 'the server did not answer with JSON-RPC');
    }
    if (out.error) throw odooError(out.error);
    return out.result as T;
  }

  version(): Promise<{ server_version: string; server_serie?: string }> {
    return this.rpc('common', 'version', []);
  }

  /** The user id for the login; Odoo answers false (not an error) on a wrong key. */
  async login(): Promise<number> {
    const { database, login, apiKey } = this.creds;
    const uid = await this.rpc<number | false>('common', 'authenticate', [
      database,
      login,
      apiKey,
      {},
    ]);
    if (!uid) throw new WriteError('Odoo refused the login or API key', 'unauthorized');
    this.uid = uid;
    return uid;
  }

  async call<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Json = {},
  ): Promise<T> {
    const uid = this.uid ?? (await this.login());
    const { context, ...rest } = kwargs;
    return this.rpc<T>('object', 'execute_kw', [
      this.creds.database,
      uid,
      this.creds.apiKey,
      model,
      method,
      args,
      { ...rest, context: { ...this.context, ...(context as Json | undefined) } },
    ]);
  }

  searchRead<T = Json>(
    model: string,
    domain: Domain,
    fields: string[],
    opts: { limit?: number; offset?: number; order?: string; context?: Json } = {},
  ): Promise<T[]> {
    return this.call<T[]>(model, 'search_read', [domain], {
      fields,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset ? { offset: opts.offset } : {}),
      ...(opts.order ? { order: opts.order } : {}),
      ...(opts.context ? { context: opts.context } : {}),
    });
  }

  read<T = Json>(model: string, ids: number[], fields: string[], context?: Json): Promise<T[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.call<T[]>(model, 'read', [ids, fields], context ? { context } : {});
  }
}

/* ---- Settings (§4.2, §5.2) --------------------------------------------------------------------- */

export interface OdooSettings {
  companyId: number | null;
  lang: string | null;
  warehouseId: number | null;
  /** Which quantity the shop gets: on hand minus reserved, on hand, or forecast. */
  stockQuantity: 'free_qty' | 'qty_available' | 'virtual_available';
  stockMatch: 'sku' | 'barcode';
  stockOnlyStorable: boolean;
  stockSafetyBuffer: number;
  batchSize: number;
}

const int = (v: unknown): number | null => {
  const n = Number(v);
  return v !== '' && v !== null && v !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};

export function odooSettings(s: Record<string, unknown> = {}): OdooSettings {
  const q = s['stock.quantity'];
  return {
    companyId: int(s.companyId),
    lang: typeof s.lang === 'string' && s.lang ? s.lang : null,
    warehouseId: int(s['stock.warehouseId']),
    stockQuantity: q === 'qty_available' || q === 'virtual_available' ? q : 'free_qty',
    stockMatch: s['stock.match'] === 'barcode' ? 'barcode' : 'sku',
    stockOnlyStorable: s['stock.onlyStorable'] !== false,
    stockSafetyBuffer: Math.max(0, Number(s['stock.safetyBuffer']) || 0),
    batchSize: Math.min(Math.max(int(s.batchSize) ?? 200, 10), 1000),
  };
}

/* ---- Lookups (§3.2) ---------------------------------------------------------------------------- */

interface ListSpec {
  model: string;
  domain: Domain;
  fields: string[];
  label: (r: Json) => string;
  meta?: (r: Json) => Meta;
}

const LISTS: Partial<Record<LookupId, ListSpec>> = {
  companies: { model: 'res.company', domain: [], fields: ['name'], label: (r) => String(r.name) },
  warehouses: {
    model: 'stock.warehouse',
    domain: [],
    fields: ['name', 'code'],
    label: (r) => `${r.name} (${r.code})`,
  },
  locations: {
    model: 'stock.location',
    domain: [['usage', '=', 'internal']],
    fields: ['complete_name'],
    label: (r) => String(r.complete_name),
  },
  pickingTypes: {
    model: 'stock.picking.type',
    domain: [['code', '=', 'outgoing']],
    fields: ['display_name'],
    label: (r) => String(r.display_name),
  },
  journals: {
    model: 'account.journal',
    domain: [],
    fields: ['name', 'code', 'type'],
    label: (r) => `${r.name} (${r.code})`,
    meta: (r) => ({ type: String(r.type) }),
  },
  taxes: {
    model: 'account.tax',
    domain: [['type_tax_use', '=', 'sale']],
    fields: ['name', 'amount', 'amount_type', 'price_include'],
    label: (r) => String(r.name),
    meta: (r) => ({
      amount: Number(r.amount),
      amountType: String(r.amount_type),
      priceInclude: r.price_include === true,
    }),
  },
  fiscalPositions: {
    model: 'account.fiscal.position',
    domain: [],
    fields: ['name', 'auto_apply', 'vat_required'],
    label: (r) => String(r.name),
    meta: (r) => ({ autoApply: r.auto_apply === true, vatRequired: r.vat_required === true }),
  },
  paymentTerms: {
    model: 'account.payment.term',
    domain: [],
    fields: ['name'],
    label: (r) => String(r.name),
  },
  pricelists: {
    model: 'product.pricelist',
    domain: [],
    fields: ['name', 'currency_id'],
    label: (r) => String(r.name),
    meta: (r) => ({ currency: m2oName(r.currency_id) ?? '' }),
  },
  productCategories: {
    model: 'product.category',
    domain: [],
    fields: ['complete_name'],
    label: (r) => String(r.complete_name),
  },
  carriers: {
    model: 'delivery.carrier',
    domain: [],
    fields: ['name'],
    label: (r) => String(r.name),
  },
  accounts: {
    model: 'account.account',
    domain: [['deprecated', '=', false]],
    fields: ['code', 'name', 'account_type'],
    label: (r) => `${r.code} ${r.name}`,
    meta: (r) => ({ type: String(r.account_type) }),
  },
};

/** Apps whose presence shows or hides options (§4.1 step 4). */
export const ODOO_APPS = [
  'sale',
  'sale_stock',
  'stock',
  'account',
  'account_accountant',
  'delivery',
  'l10n_dk',
  'l10n_eu_oss',
  'account_edi_ubl_cii',
];

/** Custom field types a template can show (§3.1); lists and files are left out. */
const CUSTOM_TYPES = new Set([
  'char',
  'text',
  'html',
  'selection',
  'integer',
  'float',
  'monetary',
  'date',
  'datetime',
  'boolean',
  'many2one',
]);

const FIELD_ATTRIBUTES = ['string', 'type', 'required', 'readonly', 'store', 'relation', 'size'];

/** Models each source port reads: the connection test checks the user may read them. */
const READ_MODELS = [
  'product.product',
  'stock.quant',
  'stock.move',
  'stock.picking',
  'account.move',
];

/* ---- Adapter ----------------------------------------------------------------------------------- */

export interface OdooContext extends AdapterContext {
  transport?: Transport;
}

const PICKING_FIELDS = [
  'name',
  'origin',
  'state',
  'date_done',
  'write_date',
  'sale_id',
  'carrier_id',
  'carrier_tracking_ref',
  'carrier_tracking_url',
];

const INVOICE_FIELDS = [
  'name',
  'move_type',
  'state',
  'payment_state',
  'currency_id',
  'amount_total',
  'amount_residual',
  'invoice_date',
  'invoice_date_due',
  'ref',
  'invoice_origin',
  'write_date',
];

const PAYMENT_STATES: Record<string, InvoiceStatus['paymentState']> = {
  not_paid: 'notPaid',
  partial: 'partial',
  in_payment: 'inPayment',
  paid: 'paid',
  reversed: 'reversed',
  // Paid before the database moved to Odoo's current accounting.
  invoicing_legacy: 'paid',
};

export class OdooAdapter implements ConnectorAdapter {
  readonly connectorId = 'odoo';
  private readonly client: OdooClient;
  private readonly settings: OdooSettings;
  private profileCache: OdooProfile | null = null;
  private readonly fieldCache = new Map<string, Map<string, Json>>();

  constructor(private readonly ctx: OdooContext) {
    const c = ctx.credentials;
    if (!c.baseUrl || !c.database || !c.login || !c.apiKey)
      throw new WriteError('Odoo credentials are incomplete', 'unauthorized');
    this.settings = odooSettings(ctx.settings);
    this.client = new OdooClient(c as unknown as OdooCredentials, ctx.transport, {
      ...(this.settings.companyId ? { allowed_company_ids: [this.settings.companyId] } : {}),
      ...(this.settings.lang ? { lang: this.settings.lang } : {}),
    });
  }

  private async profile(): Promise<OdooProfile> {
    if (this.profileCache) return this.profileCache;
    const { server_version } = await this.client.version();
    const major = odooMajor(server_version);
    const p = major !== null ? ODOO_PROFILES[major] : undefined;
    if (!p) throw new WriteError(`Odoo ${server_version} is not supported yet`, 'invalid');
    this.profileCache = p;
    return p;
  }

  /** The fields a model has in this database, so optional apps' fields are only asked for when there. */
  private async fieldsOf(model: string): Promise<Map<string, Json>> {
    const hit = this.fieldCache.get(model);
    if (hit) return hit;
    const f = await this.client.call<Record<string, Json>>(model, 'fields_get', [], {
      attributes: ['type', 'store'],
    });
    const map = new Map(Object.entries(f));
    this.fieldCache.set(model, map);
    return map;
  }

  /** The wanted fields that exist, plus the customer's own stored fields (`x_…`, §3.1). */
  private async readable(
    model: string,
    wanted: string[],
  ): Promise<{ fields: string[]; custom: string[] }> {
    const have = await this.fieldsOf(model);
    const custom = [...have.entries()]
      .filter(
        ([name, d]) =>
          name.startsWith('x_') && d.store !== false && CUSTOM_TYPES.has(String(d.type)),
      )
      .map(([name]) => name);
    return { fields: [...wanted.filter((f) => have.has(f)), ...custom], custom };
  }

  private async readFields(entity: 'shipment' | 'invoiceStatus') {
    return entity === 'shipment'
      ? this.readable('stock.picking', PICKING_FIELDS)
      : this.readable('account.move', INVOICE_FIELDS);
  }

  async test(): Promise<TestResult> {
    try {
      const { server_version } = await this.client.version();
      const major = odooMajor(server_version);
      if (major === null || !ODOO_PROFILES[major])
        return {
          ok: false,
          reason: 'unknown',
          message: `Odoo ${server_version} understøttes ikke endnu. Agentor understøtter Odoo 16.`,
        };
      const uid = await this.client.login();
      const [user] = await this.client.read<{ company_id: Many2one; company_ids: number[] }>(
        'res.users',
        [uid],
        ['company_id', 'company_ids'],
      );
      const companyId = this.settings.companyId ?? m2oId(user?.company_id);
      if (this.settings.companyId && !user?.company_ids.includes(this.settings.companyId))
        return {
          ok: false,
          reason: 'unauthorized',
          message: 'Brugeren har ikke adgang til det valgte firma i Odoo.',
        };
      const missing: string[] = [];
      for (const model of READ_MODELS) {
        const ok = await this.client
          .call<boolean>(model, 'check_access_rights', ['read'], { raise_exception: false })
          // A model from an app that isn't installed is not a missing right.
          .catch(() => true);
        if (!ok) missing.push(model);
      }
      if (missing.length)
        return {
          ok: false,
          reason: 'unauthorized',
          message: `Brugeren mangler læseadgang i Odoo til: ${missing.join(', ')}.`,
        };
      const [company] = companyId
        ? await this.client.read<{ name: string }>('res.company', [companyId], ['name'])
        : [];
      const host = new URL(this.ctx.credentials.baseUrl!).host;
      return {
        ok: true,
        account: {
          id: `${host}/${this.ctx.credentials.database}`,
          name: company?.name ?? this.ctx.credentials.database!,
        },
      };
    } catch (e) {
      const w = toWriteError(e);
      // Self-hosted servers hide the database list (§9.1), so a typo shows up here.
      if (/database .* does not exist|KeyError/i.test(w.message))
        return {
          ok: false,
          reason: 'unauthorized',
          message: `Databasen "${this.ctx.credentials.database}" findes ikke på serveren.`,
        };
      if (w.kind === 'unauthorized')
        return {
          ok: false,
          reason: 'unauthorized',
          message: 'Odoo afviste brugeren eller API-nøglen.',
        };
      if (w.kind === 'transient' || w.kind === 'rate_limited')
        return { ok: false, reason: 'unreachable', message: 'Odoo svarede ikke.' };
      if (e instanceof HttpError && e.status === 404)
        return {
          ok: false,
          reason: 'unreachable',
          message: 'Adressen svarer, men ikke som Odoo (/jsonrpc findes ikke).',
        };
      return { ok: false, reason: 'unknown', message: w.message.slice(0, 200) };
    }
  }

  async lookup(list: LookupId): Promise<LookupOption[]> {
    if (list.startsWith('fields:')) {
      const model = list.slice('fields:'.length);
      const f = await this.client.call<Record<string, Json>>(model, 'fields_get', [], {
        attributes: FIELD_ATTRIBUTES,
      });
      return Object.entries(f)
        .map(([name, d]) => ({
          value: name,
          label: String(d.string ?? name),
          meta: Object.fromEntries(
            Object.entries({
              type: d.type,
              required: d.required,
              readonly: d.readonly,
              store: d.store,
              relation: d.relation,
              size: d.size,
            }).filter(
              ([, x]) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean',
            ),
          ) as Meta,
        }))
        .sort((a, b) => a.value.localeCompare(b.value));
    }
    if (list.startsWith('relation:')) {
      const rows = await this.client.call<[number, string][]>(
        list.slice('relation:'.length),
        'name_search',
        [''],
        { limit: 500 },
      );
      return rows.map(([id, name]) => ({ value: String(id), label: name }));
    }
    if (list === 'apps') {
      const [{ server_version }, mods] = await Promise.all([
        this.client.version(),
        this.client.searchRead<{ name: string; shortdesc: string; latest_version: string }>(
          'ir.module.module',
          [
            ['state', '=', 'installed'],
            ['name', 'in', ODOO_APPS],
          ],
          ['name', 'shortdesc', 'latest_version'],
        ),
      ]);
      return [
        { value: 'odoo', label: `Odoo ${server_version}`, meta: { version: server_version } },
        ...mods.map((m) => ({
          value: m.name,
          label: m.shortdesc,
          meta: { version: m.latest_version },
        })),
      ];
    }
    const spec = LISTS[list];
    if (!spec) return [];
    const rows = await this.client.searchRead(spec.model, spec.domain, spec.fields, {
      limit: 2000,
      order: 'id asc',
    });
    return rows.map((r) => ({
      value: String(r.id),
      label: spec.label(r),
      ...(spec.meta ? { meta: spec.meta(r) } : {}),
    }));
  }

  async count(entity: Entity): Promise<number | null> {
    const domain = await this.domainOf(entity);
    if (!domain) return null;
    return this.client.call<number>(domain.model, 'search_count', [domain.domain]);
  }

  private async domainOf(entity: Entity): Promise<{ model: string; domain: Domain } | null> {
    if (entity === 'shipment')
      return {
        model: 'stock.picking',
        domain: [
          ['picking_type_code', '=', 'outgoing'],
          ['state', '=', 'done'],
        ],
      };
    if (entity === 'invoiceStatus')
      return {
        model: 'account.move',
        domain: [['move_type', 'in', ['out_invoice', 'out_refund']]],
      };
    if (entity === 'stock') {
      const p = await this.profile();
      return {
        model: 'product.product',
        domain: this.settings.stockOnlyStorable
          ? [[p.productType.field, '=', p.productType.storable]]
          : [],
      };
    }
    return null;
  }

  async fetch<E extends Entity>(entity: E, opts: FetchOptions): Promise<EntityRecord[E][]> {
    try {
      const since: Domain = opts.since ? [['write_date', '>=', toOdooTime(opts.since)]] : [];
      if (entity === 'stock')
        return (await this.fetchStock(since, opts.limit)) as EntityRecord[E][];
      if (entity === 'shipment' || entity === 'invoiceStatus') {
        const d = (await this.domainOf(entity))!;
        const { fields, custom } = await this.readFields(entity);
        const rows = await this.client.searchRead(d.model, [...d.domain, ...since], fields, {
          limit: opts.limit,
          order: 'write_date asc, id asc',
        });
        return (
          entity === 'shipment'
            ? await this.shipments(rows, custom)
            : rows.map((r) => normaliseInvoiceStatus(r, custom))
        ) as EntityRecord[E][];
      }
      return [];
    } catch (e) {
      throw toWriteError(e);
    }
  }

  async get<E extends Entity>(entity: E, sourceId: string): Promise<EntityRecord[E] | null> {
    const id = int(sourceId);
    if (!id) return null;
    try {
      if (entity === 'stock') {
        const [s] = await this.stockFor([id], null);
        return (s ?? null) as EntityRecord[E] | null;
      }
      const d = await this.domainOf(entity);
      if (!d || (entity !== 'shipment' && entity !== 'invoiceStatus')) return null;
      const { fields, custom } = await this.readFields(entity);
      const rows = await this.client.searchRead(d.model, [...d.domain, ['id', '=', id]], fields);
      if (!rows.length) return null;
      const [r] =
        entity === 'shipment'
          ? await this.shipments(rows, custom)
          : rows.map((x) => normaliseInvoiceStatus(x, custom));
      return (r ?? null) as EntityRecord[E] | null;
    } catch (e) {
      throw toWriteError(e);
    }
  }

  /**
   * Products whose stock moved since the cursor (§5.4). `free_qty` is computed, so changes are
   * found through the records that hold it: quants (counts, reservations) and done moves (a quant
   * that reaches zero may be deleted). Both are read in `write_date` order, and when either list
   * is cut off by the batch size, only changes up to the earlier cut are used, so the cursor never
   * passes a change that wasn't read.
   */
  private async fetchStock(since: Domain, limit: number): Promise<Stock[]> {
    const batch = Math.min(Math.max(limit * 2, this.settings.batchSize), 2000);
    const read = (model: string, domain: Domain) =>
      this.client.searchRead<{ product_id: Many2one; write_date: string }>(
        model,
        [...domain, ...since],
        ['product_id', 'write_date'],
        { limit: batch, order: 'write_date asc, id asc' },
      );
    const [quants, moves] = await Promise.all([
      read('stock.quant', [['location_id.usage', '=', 'internal']]),
      read('stock.move', [['state', '=', 'done']]),
    ]);
    const cuts = [quants, moves]
      .filter((rows) => rows.length >= batch)
      .map((rows) => rows.at(-1)!.write_date);
    const boundary = cuts.sort()[0] ?? null;
    const latest = new Map<number, string>();
    for (const r of [...quants, ...moves]) {
      const id = m2oId(r.product_id);
      if (!id || (boundary && r.write_date > boundary)) continue;
      if ((latest.get(id) ?? '') < r.write_date) latest.set(id, r.write_date);
    }
    const ordered = [...latest.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
    const stamps = new Map(ordered.slice(0, limit));
    return this.stockFor([...stamps.keys()], stamps);
  }

  /**
   * Quantities for products, in the configured warehouse. `stamps` carries each product's change
   * time from the cursor read; without it (reading one record) the latest change is looked up.
   */
  private async stockFor(ids: number[], stamps: Map<number, string> | null): Promise<Stock[]> {
    if (!ids.length) return [];
    const p = await this.profile();
    const s = this.settings;
    const ctx = s.warehouseId ? { warehouse: s.warehouseId } : {};
    const rows = await this.client.read<Json>(
      'product.product',
      ids,
      ['default_code', 'barcode', 'display_name', s.stockQuantity, p.productType.field],
      ctx,
    );
    const changed = stamps ?? (await this.lastStockChange(ids));
    // In change order, so the engine's cursor follows the records.
    const pos = new Map(ids.map((id, i) => [id, i]));
    return rows
      .sort((a, b) => (pos.get(Number(a.id)) ?? 0) - (pos.get(Number(b.id)) ?? 0))
      .filter((r) => !s.stockOnlyStorable || r[p.productType.field] === p.productType.storable)
      .map((r): Stock => {
        const qty = Math.floor(Number(r[s.stockQuantity]) || 0) - s.stockSafetyBuffer;
        const at = changed.get(Number(r.id));
        return {
          sourceId: String(r.id),
          sku: text(s.stockMatch === 'barcode' ? r.barcode : r.default_code),
          quantity: Math.max(qty, 0),
          ...(at ? { updatedAt: odooTime(at)! } : {}),
          raw: r,
        };
      });
  }

  private async lastStockChange(ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const [model, domain] of [
      ['stock.quant', [['location_id.usage', '=', 'internal']]],
      ['stock.move', [['state', '=', 'done']]],
    ] as const) {
      const groups = await this.client.call<{ product_id: Many2one; write_date: string | false }[]>(
        model,
        'read_group',
        [[...domain, ['product_id', 'in', ids]], ['write_date:max'], ['product_id']],
        { lazy: false },
      );
      for (const g of groups) {
        const id = m2oId(g.product_id);
        if (id && g.write_date && (out.get(id) ?? '') < g.write_date) out.set(id, g.write_date);
      }
    }
    return out;
  }

  /** Deliveries with their lines and the shop's order number from the sales order (§5.1). */
  private async shipments(rows: Json[], custom: string[]): Promise<Shipment[]> {
    if (!rows.length) return [];
    const p = await this.profile();
    const ids = rows.map((r) => Number(r.id));
    const moves = await this.client.searchRead<Json>(
      'stock.move',
      [['picking_id', 'in', ids]],
      ['picking_id', 'product_id', 'name', p.moveDoneQty],
      { order: 'id asc' },
    );
    const productIds = [
      ...new Set(moves.map((m) => m2oId(m.product_id)).filter((x): x is number => !!x)),
    ];
    const skus = new Map(
      (await this.client.read<Json>('product.product', productIds, ['default_code'])).map((r) => [
        Number(r.id),
        text(r.default_code),
      ]),
    );
    const saleIds = [...new Set(rows.map((r) => m2oId(r.sale_id)).filter((x): x is number => !!x))];
    const refs = new Map(
      (await this.client.read<Json>('sale.order', saleIds, ['client_order_ref'])).map((r) => [
        Number(r.id),
        text(r.client_order_ref),
      ]),
    );
    return rows.map((r): Shipment => {
      const saleId = m2oId(r.sale_id);
      return {
        sourceId: String(r.id),
        number: String(r.name),
        orderRef: (saleId ? refs.get(saleId) : null) ?? text(r.origin),
        state: r.state === 'cancel' ? 'cancelled' : 'done',
        doneAt: odooTime(r.date_done),
        carrier: m2oName(r.carrier_id),
        trackingRef: text(r.carrier_tracking_ref),
        trackingUrl: text(r.carrier_tracking_url),
        lines: moves
          .filter((m) => m2oId(m.picking_id) === Number(r.id))
          .map((m) => ({
            sku: skus.get(m2oId(m.product_id) ?? 0) ?? null,
            name: String(m.name ?? ''),
            quantity: Number(m[p.moveDoneQty]) || 0,
          })),
        updatedAt: odooTime(r.write_date)!,
        fields: customValues(r, custom),
        raw: r,
      };
    });
  }

  write(): Promise<WriteResult> {
    // Odoo as a destination is P2 (PLAN-INTEGRATIONS-WOO-ODOO16 §7); the manifest has no inputs yet.
    return Promise.reject(new WriteError('Odoo writes are not available yet', 'invalid'));
  }

  parseWebhook(): WebhookChange | null {
    return null;
  }
}

/** Custom field values for templates: relations as their display name, empty as null. */
export function customValues(
  r: Json,
  names: string[],
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const n of names) {
    const v = r[n];
    out[n] = Array.isArray(v)
      ? m2oName(v)
      : typeof v === 'string' || typeof v === 'number'
        ? v
        : v === true
          ? true
          : null;
  }
  return out;
}

export function normaliseInvoiceStatus(r: Json, custom: string[] = []): InvoiceStatus {
  const name = text(r.name);
  return {
    sourceId: String(r.id),
    kind: r.move_type === 'out_refund' ? 'creditNote' : 'invoice',
    // Drafts are named "/" until they are posted.
    number: name && name !== '/' ? name : null,
    orderRef: text(r.ref) ?? text(r.invoice_origin),
    state: r.state === 'posted' ? 'posted' : r.state === 'cancel' ? 'cancelled' : 'draft',
    paymentState: PAYMENT_STATES[String(r.payment_state)] ?? 'notPaid',
    currency: m2oName(r.currency_id) ?? '',
    total: ore(r.amount_total),
    residual: ore(r.amount_residual),
    date: text(r.invoice_date),
    dueDate: text(r.invoice_date_due),
    updatedAt: odooTime(r.write_date)!,
    fields: customValues(r, custom),
    raw: r,
  };
}
