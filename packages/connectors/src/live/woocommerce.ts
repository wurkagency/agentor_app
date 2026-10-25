import { randomBytes } from 'node:crypto';
import {
  WriteError,
  type AccountInfo,
  type AdapterContext,
  type ConnectorAdapter,
  type FetchOptions,
  type LookupOption,
  type TestResult,
  type WebhookChange,
  type WebhookStatus,
  type WriteOptions,
  type WriteResult,
} from '../adapter.js';
import type { LookupId } from '../manifest.js';
import type {
  Address,
  CreditNote,
  Customer,
  Entity,
  EntityRecord,
  Order,
  OrderLine,
  Party,
  Product,
  Stock,
  VatLine,
} from '../model.js';
import {
  gmt,
  HttpError,
  ore,
  retryAfter,
  safeTransport,
  toWriteError,
  type Transport,
} from './http.js';

/**
 * WooCommerce live client (PLAN-INTEGRATIONS-WOO-DINERO §4): REST API wc/v3 on the shop's own
 * domain. Keys go in Basic auth over HTTPS; hosts that strip the Authorization header get the
 * query-string form. Webhooks are hints only, so every change is read back from the API.
 */

type Json = Record<string, unknown>;

interface WooMeta {
  key: string;
  value: unknown;
}

interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface WooTaxRef {
  id: number;
  total?: string;
  subtotal?: string;
}

interface WooLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;
  quantity: number;
  tax_class?: string;
  subtotal: string;
  subtotal_tax?: string;
  total: string;
  total_tax: string;
  taxes?: WooTaxRef[];
  meta_data?: WooMeta[];
  sku?: string | null;
}

interface WooFeeLine {
  id: number;
  name: string;
  total: string;
  total_tax: string;
  taxes?: WooTaxRef[];
}

interface WooShippingLine {
  id: number;
  method_title: string;
  total: string;
  total_tax: string;
  taxes?: WooTaxRef[];
}

interface WooTaxLine {
  id: number;
  rate_code?: string;
  rate_id: number;
  label?: string;
  tax_total: string;
  shipping_tax_total: string;
  rate_percent?: number;
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  prices_include_tax?: boolean;
  date_created_gmt: string;
  date_modified_gmt?: string;
  date_paid_gmt?: string | null;
  date_completed_gmt?: string | null;
  customer_id: number;
  customer_note?: string;
  billing: WooAddress;
  shipping: WooAddress;
  payment_method?: string;
  payment_method_title?: string;
  transaction_id?: string;
  total: string;
  meta_data?: WooMeta[];
  line_items: WooLineItem[];
  tax_lines?: WooTaxLine[];
  shipping_lines?: WooShippingLine[];
  fee_lines?: WooFeeLine[];
  coupon_lines?: { code: string }[];
  refunds?: { id: number; total: string }[];
}

export interface WooRefund {
  id: number;
  date_created_gmt: string;
  amount: string;
  reason?: string;
  refunded_payment?: boolean;
  meta_data?: WooMeta[];
  line_items?: WooLineItem[];
  shipping_lines?: WooShippingLine[];
  fee_lines?: WooFeeLine[];
}

export interface WooCustomer {
  id: number;
  date_modified_gmt?: string;
  date_created_gmt?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  billing: WooAddress;
  shipping: WooAddress;
  meta_data?: WooMeta[];
}

export interface WooProduct {
  id: number;
  parent_id?: number;
  name: string;
  sku?: string;
  type?: string;
  regular_price?: string;
  price?: string;
  tax_status?: string;
  tax_class?: string;
  global_unique_id?: string;
  manage_stock?: boolean | 'parent';
  stock_quantity?: number | null;
  date_modified_gmt?: string;
  categories?: { id: number; name: string }[];
}

/** The connection settings this client reads (manifest `connectionSettings`). */
export interface WooSettings {
  vatNumberKey: string;
  cvrKey: string;
  eanKey: string;
  orderNumber: 'number' | 'id';
  extraMeta: { key: string; alias: string }[];
  /** Meta keys left out of `raw` (order attribution and other tracking). */
  ignorePrefixes: string[];
}

export function wooSettings(s: Record<string, unknown> = {}): WooSettings {
  const str = (k: string, d: string) => (typeof s[k] === 'string' ? (s[k] as string) : d);
  const extra = Array.isArray(s['meta.extra'])
    ? (s['meta.extra'] as unknown[]).flatMap((x) => {
        const r = x as { key?: unknown; alias?: unknown };
        return typeof r.key === 'string' &&
          typeof r.alias === 'string' &&
          /^\w{1,40}$/.test(r.alias)
          ? [{ key: r.key, alias: r.alias }]
          : [];
      })
    : [];
  return {
    vatNumberKey: str('meta.vatNumber', '_billing_vat_number'),
    cvrKey: str('meta.cvr', ''),
    eanKey: str('meta.ean', ''),
    orderNumber: s['orderNumber.source'] === 'id' ? 'id' : 'number',
    extraMeta: extra,
    ignorePrefixes: str('ignoreMetaPrefixes', '_wc_order_attribution_')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

/* ---- Normalising ------------------------------------------------------------------------------- */

const NORMALISED: Record<string, Order['status']> = {
  pending: 'pending',
  'on-hold': 'pending',
  processing: 'processing',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'cancelled',
  trash: 'cancelled',
  refunded: 'refunded',
};

function metaValue(meta: WooMeta[] | undefined, key: string): string | null {
  if (!key) return null;
  // Block-checkout fields live under `_wc_billing/…`, classic plugins often without the underscore.
  const alt = key.startsWith('_') ? key.slice(1) : `_${key}`;
  const hit = meta?.find((m) => m.key === key) ?? meta?.find((m) => m.key === alt);
  if (!hit || hit.value === null || hit.value === undefined) return null;
  const v = typeof hit.value === 'string' ? hit.value : JSON.stringify(hit.value);
  return v.trim() ? v.trim().slice(0, 200) : null;
}

const join = (...parts: (string | undefined | null)[]) =>
  parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');

function address(a: WooAddress | undefined): Address {
  return {
    line1: a?.address_1?.trim() || null,
    line2: a?.address_2?.trim() || null,
    postalCode: a?.postcode?.trim() || null,
    city: a?.city?.trim() || null,
    state: a?.state?.trim() || null,
    country: (a?.country || 'DK').toUpperCase(),
  };
}

function party(a: WooAddress | undefined): Party | null {
  if (!a) return null;
  const name = join(a.first_name, a.last_name);
  if (!name && !a.company && !a.address_1) return null;
  return {
    name: name || a.company || '',
    company: a.company?.trim() || null,
    email: a.email?.trim() || null,
    phone: a.phone?.trim() || null,
    address: address(a),
  };
}

/** The rate behind a tax reference, from the order's tax lines (`rate_percent`, WC 5.7+). */
function rateOf(
  taxes: WooTaxRef[] | undefined,
  taxLines: WooTaxLine[] | undefined,
  net: number,
  tax: number,
): number {
  const ref = taxes?.find((t) => Number.parseFloat(t.total ?? t.subtotal ?? '0') !== 0);
  const line = ref ? taxLines?.find((t) => t.rate_id === ref.id) : undefined;
  if (line && typeof line.rate_percent === 'number') return line.rate_percent / 100;
  if (net === 0 || tax === 0) return 0;
  // Older shops: the rate from the amounts, rounded to a tenth of a percent.
  return Math.round((tax / net) * 1000) / 1000;
}

function customerFromOrder(o: WooOrder, s: WooSettings): Customer {
  const b = o.billing ?? {};
  const vatNumber = metaValue(o.meta_data, s.vatNumberKey);
  const company = b.company?.trim() || null;
  const email = b.email?.trim().toLowerCase() || null;
  const name = join(b.first_name, b.last_name);
  return {
    sourceId:
      o.customer_id > 0 ? String(o.customer_id) : email ? `guest:${email}` : `guest:order-${o.id}`,
    kind: company || vatNumber ? 'company' : 'person',
    name: company || name || email || `Ordre ${o.number}`,
    email,
    phone: b.phone?.trim() || null,
    vatNumber,
    address: address(b),
    companyName: company,
    cvr: metaValue(o.meta_data, s.cvrKey),
    ean: metaValue(o.meta_data, s.eanKey),
    isGuest: o.customer_id === 0,
    shippingAddress: o.shipping?.address_1 ? address(o.shipping) : null,
  };
}

function line(
  li: WooLineItem,
  taxLines: WooTaxLine[] | undefined,
  categories: Map<number, string[]>,
  sign = 1,
): OrderLine {
  const quantity = Math.abs(li.quantity) || 1;
  const subtotal = Math.abs(ore(li.subtotal));
  const total = Math.abs(ore(li.total));
  const tax = Math.abs(ore(li.total_tax));
  const bundleParent = metaValue(li.meta_data, '_bundled_by');
  const cats = categories.get(li.product_id) ?? [];
  return {
    sku: li.sku?.trim() || null,
    productId: String(li.variation_id || li.product_id || '') || null,
    name: li.name,
    quantity: quantity * sign,
    unitPrice: Math.round(subtotal / quantity),
    vatRate: rateOf(li.taxes, taxLines, total, tax),
    category: cats[0] ?? null,
    kind: 'product',
    variantId: li.variation_id ? String(li.variation_id) : null,
    taxClass: li.tax_class || null,
    discount: Math.max(subtotal - total, 0),
    bundleParent: bundleParent ?? null,
  };
}

function feeLine(f: WooFeeLine, taxLines: WooTaxLine[] | undefined): OrderLine {
  const total = ore(f.total);
  return {
    sku: null,
    productId: null,
    name: f.name,
    quantity: 1,
    unitPrice: total,
    vatRate: rateOf(f.taxes, taxLines, total, ore(f.total_tax)),
    category: null,
    kind: 'fee',
  };
}

function vatLines(o: { tax_lines?: WooTaxLine[] }): VatLine[] {
  return (o.tax_lines ?? []).map((t) => ({
    rateId: String(t.rate_id),
    code: t.rate_code ?? null,
    label: t.label ?? null,
    rate: typeof t.rate_percent === 'number' ? t.rate_percent / 100 : 0,
    amount: ore(t.tax_total) + ore(t.shipping_tax_total),
  }));
}

function meta(m: WooMeta[] | undefined, s: WooSettings): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (alias: string, key: string) => {
    const v = metaValue(m, key);
    if (v) out[alias] = v;
  };
  set('vatNumber', s.vatNumberKey);
  set('cvr', s.cvrKey);
  set('ean', s.eanKey);
  for (const e of s.extraMeta) set(e.alias, e.key);
  return out;
}

/** The source payload without tracking meta (order attribution). */
function rawOf<T extends { meta_data?: WooMeta[] }>(o: T, s: WooSettings): T {
  if (!o.meta_data) return o;
  return {
    ...o,
    meta_data: o.meta_data.filter((m) => !s.ignorePrefixes.some((p) => m.key.startsWith(p))),
  };
}

/**
 * A WooCommerce order in the common model. Bundle children without their own price are left out
 * (their parent carries the amount, PLAN F13); fees become lines of kind `fee`.
 */
export function normaliseOrder(
  o: WooOrder,
  s: WooSettings,
  categories: Map<number, string[]> = new Map(),
): Order {
  const lines = o.line_items
    .filter((li) => !(metaValue(li.meta_data, '_bundled_by') && ore(li.total) === 0))
    .map((li) => line(li, o.tax_lines, categories));
  for (const f of o.fee_lines ?? []) lines.push(feeLine(f, o.tax_lines));
  const shippingNet = (o.shipping_lines ?? []).reduce((n, l) => n + ore(l.total), 0);
  const shippingTax = (o.shipping_lines ?? []).reduce((n, l) => n + ore(l.total_tax), 0);
  const firstShipping = o.shipping_lines?.find((l) => ore(l.total) !== 0);
  const updatedAt = gmt(o.date_modified_gmt);
  return {
    sourceId: String(o.id),
    number: s.orderNumber === 'id' ? String(o.id) : String(o.number || o.id),
    createdAt: gmt(o.date_created_gmt) ?? new Date(0).toISOString(),
    ...(updatedAt ? { updatedAt } : {}),
    paidAt: gmt(o.date_paid_gmt),
    completedAt: gmt(o.date_completed_gmt),
    status: NORMALISED[o.status] ?? 'processing',
    sourceStatus: o.status,
    currency: o.currency || 'DKK',
    customer: customerFromOrder(o, s),
    lines,
    shipping: shippingNet,
    shippingVatRate: firstShipping
      ? rateOf(firstShipping.taxes, o.tax_lines, shippingNet, shippingTax)
      : 0,
    total: ore(o.total),
    pricesIncludeVat: o.prices_include_tax ?? false,
    paymentMethod: o.payment_method
      ? { id: o.payment_method, title: o.payment_method_title || o.payment_method }
      : null,
    transactionId: o.transaction_id?.trim() || null,
    shippingMethod: (o.shipping_lines ?? []).map((l) => l.method_title).join(', ') || null,
    couponCodes: (o.coupon_lines ?? []).map((c) => c.code),
    billing: party(o.billing),
    shippingTo: party(o.shipping),
    note: o.customer_note?.trim() || null,
    vatLines: vatLines(o),
    meta: meta(o.meta_data, s),
    raw: rawOf(o, s),
  };
}

/**
 * A refund as a credit note. Refund amounts are negative in WooCommerce; here they are positive,
 * like the original order. A refund without lines (amount only) becomes one line at the order's
 * VAT rate, so the credit note still balances.
 */
export function normaliseRefund(
  r: WooRefund,
  order: WooOrder,
  s: WooSettings,
  categories: Map<number, string[]> = new Map(),
): CreditNote {
  const parent = normaliseOrder(order, s, categories);
  const lines = (r.line_items ?? [])
    .filter((li) => ore(li.total) !== 0)
    .map((li) => line(li, order.tax_lines, categories));
  for (const f of r.fee_lines ?? [])
    if (ore(f.total) !== 0) {
      const fee = feeLine(f, order.tax_lines);
      lines.push({ ...fee, unitPrice: Math.abs(fee.unitPrice) });
    }
  for (const sl of r.shipping_lines ?? [])
    if (ore(sl.total) !== 0) {
      const net = Math.abs(ore(sl.total));
      lines.push({
        sku: null,
        productId: null,
        name: sl.method_title || 'Fragt',
        quantity: 1,
        unitPrice: net,
        vatRate: rateOf(sl.taxes, order.tax_lines, net, Math.abs(ore(sl.total_tax))),
        category: null,
        kind: 'fee',
      });
    }
  const amount = Math.abs(ore(r.amount));
  if (lines.length === 0 && amount > 0) {
    const rate = parent.lines.find((l) => l.vatRate > 0)?.vatRate ?? 0;
    lines.push({
      sku: null,
      productId: null,
      name: r.reason?.trim() || `Refusion af ordre ${parent.number}`,
      quantity: 1,
      unitPrice: Math.round(amount / (1 + rate)),
      vatRate: rate,
      category: null,
      kind: 'fee',
    });
  }
  return {
    sourceId: String(r.id),
    number: String(r.id),
    orderSourceId: String(order.id),
    createdAt: gmt(r.date_created_gmt) ?? parent.createdAt,
    currency: parent.currency,
    customer: parent.customer,
    lines,
    total: amount,
    reason: r.reason?.trim() || null,
    refundsPayment: r.refunded_payment ?? false,
    meta: { ...parent.meta, orderNumber: parent.number },
    raw: rawOf(r, s),
  };
}

export function normaliseCustomer(c: WooCustomer, s: WooSettings): Customer {
  const b = c.billing ?? {};
  const vatNumber = metaValue(c.meta_data, s.vatNumberKey);
  const company = b.company?.trim() || null;
  const name = join(c.first_name || b.first_name, c.last_name || b.last_name);
  const email = (c.email || b.email || '').trim().toLowerCase() || null;
  return {
    sourceId: String(c.id),
    kind: company || vatNumber ? 'company' : 'person',
    name: company || name || email || `Kunde ${c.id}`,
    email,
    phone: b.phone?.trim() || null,
    vatNumber,
    address: address(b),
    companyName: company,
    cvr: metaValue(c.meta_data, s.cvrKey),
    ean: metaValue(c.meta_data, s.eanKey),
    isGuest: false,
    shippingAddress: c.shipping?.address_1 ? address(c.shipping) : null,
    ...(gmt(c.date_modified_gmt) ? { updatedAt: gmt(c.date_modified_gmt)! } : {}),
  };
}

export function normaliseProduct(p: WooProduct): Product {
  const cats = (p.categories ?? []).map((c) => c.name);
  const vatFree = p.tax_status === 'none' || /zero/i.test(p.tax_class ?? '');
  return {
    sourceId: String(p.id),
    sku: p.sku?.trim() || null,
    name: p.name,
    category: cats[0] ?? null,
    categories: cats,
    price: ore(p.regular_price || p.price),
    vatRate: vatFree ? 0 : 0.25,
    ean: p.global_unique_id?.trim() || null,
    variantOf: p.parent_id ? String(p.parent_id) : null,
    taxClass: p.tax_class || null,
    ...(gmt(p.date_modified_gmt) ? { updatedAt: gmt(p.date_modified_gmt)! } : {}),
  };
}

/* ---- Client ------------------------------------------------------------------------------------ */

export interface WooCredentials {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** Where the shop delivers webhooks: Agentor ingest with the connection's token. */
  webhookUrl?: string;
  webhookSecret?: string;
  /** "query" when the host strips the Authorization header. */
  authMode?: string;
}

const PER_PAGE = 100;

export class WooClient {
  private authMode: 'basic' | 'query';

  constructor(
    private readonly creds: WooCredentials,
    private readonly transport: Transport = safeTransport,
    private readonly onAuthMode?: (mode: 'query') => Promise<void>,
  ) {
    this.authMode = creds.authMode === 'query' ? 'query' : 'basic';
  }

  private url(path: string, query: Record<string, string | number | undefined> = {}) {
    const u = new URL(`${this.creds.baseUrl.replace(/\/+$/, '')}/wp-json/wc/v3${path}`);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) u.searchParams.set(k, String(v));
    if (this.authMode === 'query') {
      u.searchParams.set('consumer_key', this.creds.consumerKey);
      u.searchParams.set('consumer_secret', this.creds.consumerSecret);
    }
    return u.toString();
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<{ data: T; headers: Record<string, string> }> {
    const send = () =>
      this.transport(this.url(path, opts.query), {
        method,
        headers: {
          accept: 'application/json',
          ...(this.authMode === 'basic'
            ? {
                authorization: `Basic ${Buffer.from(`${this.creds.consumerKey}:${this.creds.consumerSecret}`).toString('base64')}`,
              }
            : {}),
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    let res = await send();
    // FastCGI hosts drop the Authorization header; WooCommerce then says the key is missing.
    if (res.status === 401 && this.authMode === 'basic' && /consumer.?key/i.test(res.body)) {
      this.authMode = 'query';
      res = await send();
      if (res.status < 400) await this.onAuthMode?.('query');
    }
    if (res.status >= 400)
      throw new HttpError(
        res.status,
        res.body.slice(0, 500),
        res.status === 429 ? retryAfter(res.headers, 60_000) : null,
      );
    let data: T;
    try {
      data = (res.body ? JSON.parse(res.body) : null) as T;
    } catch {
      // Security plugins and caches answer with HTML: not something to retry blindly.
      throw new HttpError(502, 'the shop did not answer with JSON');
    }
    return { data, headers: res.headers };
  }

  /** Pages through a list until `limit` items or the last page (`X-WP-TotalPages`). */
  async list<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    limit: number,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < limit; page++) {
      const { data, headers } = await this.request<T[]>('GET', path, {
        query: { ...query, per_page: Math.min(PER_PAGE, Math.max(limit - out.length, 1)), page },
      });
      if (!Array.isArray(data) || data.length === 0) break;
      out.push(...data);
      const pages = Number(headers['x-wp-totalpages'] ?? '1');
      if (!Number.isFinite(pages) || page >= pages) break;
    }
    return out.slice(0, limit);
  }

  async total(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<number | null> {
    const { headers } = await this.request<unknown[]>('GET', path, {
      query: { ...query, per_page: 1 },
    });
    const n = Number(headers['x-wp-total']);
    return Number.isFinite(n) ? n : null;
  }
}

/* ---- Adapter ----------------------------------------------------------------------------------- */

const WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'order.deleted',
  'customer.created',
  'customer.updated',
  'product.updated',
] as const;

const TOPIC_ENTITY: Record<string, Entity> = {
  order: 'order',
  customer: 'customer',
  product: 'product',
};

export interface WooContext extends AdapterContext {
  transport?: Transport;
  /** Names our webhooks in the shop, so two connections to one shop don't touch each other's. */
  connectionId?: string;
}

export class WooAdapter implements ConnectorAdapter {
  readonly connectorId = 'woocommerce';
  private readonly client: WooClient;
  private readonly settings: WooSettings;
  private readonly categoryCache = new Map<number, string[]>();

  constructor(private readonly ctx: WooContext) {
    const c = ctx.credentials;
    if (!c.baseUrl || !c.consumerKey || !c.consumerSecret)
      throw new WriteError('WooCommerce credentials are incomplete', 'unauthorized');
    this.client = new WooClient(c as unknown as WooCredentials, ctx.transport, async (mode) => {
      await ctx.persist?.({ authMode: mode });
    });
    this.settings = wooSettings(ctx.settings);
  }

  private get host() {
    return new URL(this.ctx.credentials.baseUrl!).host;
  }

  async test(): Promise<TestResult> {
    try {
      await this.client.request('GET', '/orders', { query: { per_page: 1 } });
      const account: AccountInfo = { id: this.host, name: this.host };
      return { ok: true, account };
    } catch (e) {
      const w = toWriteError(e);
      if (w.kind === 'unauthorized')
        return { ok: false, reason: 'unauthorized', message: 'WooCommerce afviste nøglerne.' };
      if (w.kind === 'transient' || w.kind === 'rate_limited')
        return { ok: false, reason: 'unreachable', message: 'Butikken svarede ikke.' };
      return { ok: false, reason: 'unknown', message: w.message.slice(0, 200) };
    }
  }

  /** Product categories for order lines (category → account mapping), one call per new batch. */
  private async categories(productIds: number[]): Promise<Map<number, string[]>> {
    const missing = [...new Set(productIds.filter((id) => id > 0 && !this.categoryCache.has(id)))];
    for (let i = 0; i < missing.length; i += PER_PAGE) {
      const batch = missing.slice(i, i + PER_PAGE);
      const products = await this.client.list<WooProduct>(
        '/products',
        { include: batch.join(','), status: 'any' },
        batch.length,
      );
      for (const id of batch) this.categoryCache.set(id, []);
      for (const p of products)
        this.categoryCache.set(
          p.id,
          (p.categories ?? []).map((c) => c.name),
        );
    }
    return this.categoryCache;
  }

  private async enrich(orders: WooOrder[]) {
    return this.categories(orders.flatMap((o) => o.line_items.map((l) => l.product_id)));
  }

  private changedOrders(opts: FetchOptions, limit: number) {
    return this.client.list<WooOrder>(
      '/orders',
      {
        orderby: 'modified',
        order: 'asc',
        dates_are_gmt: 'true',
        ...(opts.since ? { modified_after: opts.since.replace(/\.\d{3}Z$/, 'Z') } : {}),
      },
      limit,
    );
  }

  private async refundsOf(o: WooOrder): Promise<CreditNote[]> {
    if (!o.refunds?.length) return [];
    const refunds = await this.client.list<WooRefund>(`/orders/${o.id}/refunds`, {}, 100);
    const cats = await this.enrich([o]);
    return refunds.map((r) => normaliseRefund(r, o, this.settings, cats));
  }

  async fetch<E extends Entity>(entity: E, opts: FetchOptions): Promise<EntityRecord[E][]> {
    const limit = Math.max(1, opts.limit);
    if (entity === 'order') {
      const orders = await this.changedOrders(opts, limit);
      const cats = await this.enrich(orders);
      return orders.map((o) => normaliseOrder(o, this.settings, cats)) as EntityRecord[E][];
    }
    if (entity === 'creditNote') {
      // No refund cursor in WooCommerce (F10): refunds of the orders that changed.
      const out: CreditNote[] = [];
      for (const o of await this.changedOrders(opts, Math.max(limit, 100))) {
        out.push(...(await this.refundsOf(o)));
        if (out.length >= limit) break;
      }
      return out.slice(0, limit) as EntityRecord[E][];
    }
    if (entity === 'customer') {
      // No modified_after on customers: newest first, stop at the cursor (webhooks cover edits).
      const since = opts.since ? Date.parse(opts.since) : null;
      const rows = await this.client.list<WooCustomer>(
        '/customers',
        { orderby: 'registered_date', order: 'desc' },
        since === null ? limit : Math.max(limit, 500),
      );
      return rows
        .filter(
          (c) =>
            since === null ||
            Date.parse(gmt(c.date_modified_gmt ?? c.date_created_gmt) ?? '') >= since,
        )
        .slice(0, limit)
        .reverse()
        .map((c) => normaliseCustomer(c, this.settings)) as EntityRecord[E][];
    }
    if (entity === 'product') {
      const rows = await this.client.list<WooProduct>(
        '/products',
        {
          orderby: 'id',
          order: 'asc',
          dates_are_gmt: 'true',
          ...(opts.since ? { modified_after: opts.since.replace(/\.\d{3}Z$/, 'Z') } : {}),
        },
        limit,
      );
      return rows.map(normaliseProduct) as EntityRecord[E][];
    }
    return [];
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return (await this.client.request<T>('GET', path)).data;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return null;
      throw e;
    }
  }

  async get<E extends Entity>(entity: E, sourceId: string): Promise<EntityRecord[E] | null> {
    if (!/^[\w:@.+-]{1,200}$/.test(sourceId)) return null;
    if (entity === 'order') {
      if (!/^\d+$/.test(sourceId)) return null;
      const o = await this.getOrNull<WooOrder>(`/orders/${sourceId}`);
      if (!o) return null;
      return normaliseOrder(o, this.settings, await this.enrich([o])) as EntityRecord[E];
    }
    if (entity === 'creditNote') {
      if (!/^\d+$/.test(sourceId)) return null;
      const [ref] = (
        await this.client.request<{ id: number; parent_id: number }[]>('GET', '/refunds', {
          query: { include: sourceId },
        })
      ).data;
      if (!ref) return null;
      const order = await this.getOrNull<WooOrder>(`/orders/${ref.parent_id}`);
      const refund = await this.getOrNull<WooRefund>(
        `/orders/${ref.parent_id}/refunds/${sourceId}`,
      );
      if (!order || !refund) return null;
      return normaliseRefund(
        refund,
        order,
        this.settings,
        await this.enrich([order]),
      ) as EntityRecord[E];
    }
    if (entity === 'customer') {
      // Guests exist only on their orders.
      if (!/^\d+$/.test(sourceId)) return null;
      const c = await this.getOrNull<WooCustomer>(`/customers/${sourceId}`);
      return c ? (normaliseCustomer(c, this.settings) as EntityRecord[E]) : null;
    }
    if (entity === 'product') {
      if (!/^\d+$/.test(sourceId)) return null;
      const p = await this.getOrNull<WooProduct>(`/products/${sourceId}`);
      return p ? (normaliseProduct(p) as EntityRecord[E]) : null;
    }
    return null;
  }

  async count(entity: Entity): Promise<number | null> {
    const path =
      entity === 'order'
        ? '/orders'
        : entity === 'customer'
          ? '/customers'
          : entity === 'product'
            ? '/products'
            : null;
    return path ? this.client.total(path) : null;
  }

  async lookup(list: LookupId): Promise<LookupOption[]> {
    if (list === 'orderStatuses') {
      // Includes statuses added by plugins (B2B, shipping), unlike the documented list.
      const { data } = await this.client.request<{ slug: string; name: string }[]>(
        'GET',
        '/reports/orders/totals',
      );
      return data.map((s) => ({ value: s.slug, label: s.name }));
    }
    if (list === 'paymentGateways') {
      const { data } = await this.client.request<
        { id: string; title: string; method_title?: string; enabled: boolean }[]
      >('GET', '/payment_gateways');
      return data
        .filter((g) => g.enabled)
        .map((g) => ({ value: g.id, label: g.title || g.method_title || g.id }));
    }
    if (list === 'shippingMethods') {
      const { data } = await this.client.request<{ id: string; title: string }[]>(
        'GET',
        '/shipping_methods',
      );
      return data.map((m) => ({ value: m.id, label: m.title }));
    }
    if (list === 'taxClasses') {
      const { data } = await this.client.request<{ slug: string; name: string }[]>(
        'GET',
        '/taxes/classes',
      );
      return data.map((c) => ({ value: c.slug, label: c.name }));
    }
    if (list === 'taxRates') {
      const rows = await this.client.list<{
        id: number;
        country: string;
        rate: string;
        name: string;
      }>('/taxes', {}, 500);
      return rows.map((r) => ({
        value: String(r.id),
        label: `${r.country || '*'} ${Number(r.rate)} % ${r.name}`.trim(),
      }));
    }
    if (list === 'categories') {
      const rows = await this.client.list<{ id: number; name: string }>(
        '/products/categories',
        {},
        1000,
      );
      return rows.map((c) => ({ value: c.name, label: c.name }));
    }
    return [];
  }

  /**
   * Stock write-back (PLAN §4.6): the product or variation with the SKU gets its quantity, with
   * stock management switched on. Negative quantities are written as 0 by default.
   */
  async write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: WriteOptions,
  ): Promise<WriteResult> {
    if (entity !== 'stock')
      throw new WriteError(`WooCommerce does not receive ${entity}`, 'invalid');
    const s = record as Stock;
    try {
      const target = opts.existingId
        ? await this.stockTargetById(opts.existingId)
        : await this.stockTargetBySku(s.sku);
      if (!target) throw new WriteError(`no product with SKU ${s.sku ?? '(none)'}`, 'invalid');
      const id = target.parent ? `${target.parent}/variations/${target.id}` : String(target.id);
      if (opts.mode === 'dry_run') return { action: 'update', destinationId: null };
      await this.client.request('PUT', `/products/${id}`, {
        body: { manage_stock: true, stock_quantity: Math.max(0, Math.round(s.quantity)) },
      });
      return {
        action: 'update',
        destinationId: target.parent ? `${target.parent}:${target.id}` : String(target.id),
      };
    } catch (e) {
      throw toWriteError(e);
    }
  }

  private async stockTargetBySku(sku: string | null) {
    if (!sku) return null;
    const { data } = await this.client.request<WooProduct[]>('GET', '/products', {
      query: { sku },
    });
    const p = data.find((x) => x.sku === sku);
    return p ? { id: p.id, parent: p.parent_id || null } : null;
  }

  private async stockTargetById(id: string) {
    const m = /^(?:(\d+):)?(\d+)$/.exec(id);
    return m ? { id: Number(m[2]), parent: m[1] ? Number(m[1]) : null } : null;
  }

  /** An internal note on the order, e.g. "Bogført i Dinero som faktura 1042" (PLAN §4.6). */
  async addOrderNote(orderId: string, note: string, customerNote = false): Promise<void> {
    try {
      await this.client.request('POST', `/orders/${encodeURIComponent(orderId)}/notes`, {
        body: { note: note.slice(0, 2000), customer_note: customerNote },
      });
    } catch (e) {
      throw toWriteError(e);
    }
  }

  async setOrderStatus(orderId: string, status: string): Promise<void> {
    if (!/^[a-z0-9-]{1,40}$/.test(status)) throw new WriteError('invalid status', 'invalid');
    try {
      await this.client.request('PUT', `/orders/${encodeURIComponent(orderId)}`, {
        body: { status },
      });
    } catch (e) {
      throw toWriteError(e);
    }
  }

  /**
   * A refund on the order (PLAN §4.7 C). `throughGateway` asks the payment gateway to pay it
   * back; the tag in meta makes a repeated call find the first refund instead of paying twice.
   */
  async createRefund(
    orderId: string,
    r: { amount: number; reason: string; tag: string; throughGateway: boolean; restock: boolean },
  ): Promise<{ refundId: string; existed: boolean }> {
    try {
      const existing = await this.client.list<WooRefund>(
        `/orders/${encodeURIComponent(orderId)}/refunds`,
        {},
        100,
      );
      const hit = existing.find((x) =>
        x.meta_data?.some((m) => m.key === '_agentor_credit_note' && m.value === r.tag),
      );
      if (hit) return { refundId: String(hit.id), existed: true };
      const { data } = await this.client.request<WooRefund>(
        'POST',
        `/orders/${encodeURIComponent(orderId)}/refunds`,
        {
          body: {
            amount: (r.amount / 100).toFixed(2),
            reason: r.reason.slice(0, 200),
            api_refund: r.throughGateway,
            api_restock: r.restock,
            meta_data: [{ key: '_agentor_credit_note', value: r.tag }],
          },
        },
      );
      return { refundId: String(data.id), existed: false };
    } catch (e) {
      throw toWriteError(e);
    }
  }

  parseWebhook(rawBody: string, headers: Record<string, string>): WebhookChange | null {
    const topic = headers['x-wc-webhook-topic'] ?? '';
    const [resource] = topic.split('.');
    const entity = resource ? TOPIC_ENTITY[resource] : undefined;
    if (!entity) return null;
    let body: Json;
    try {
      body = JSON.parse(rawBody) as Json;
    } catch {
      return null; // the creation ping is form-encoded
    }
    const id = body.id;
    if (typeof id !== 'number' && typeof id !== 'string') return null;
    const delivery = headers['x-wc-webhook-delivery-id'];
    return {
      entity,
      sourceIds: [String(id).slice(0, 40)],
      deliveryId: delivery ? `${headers['x-wc-webhook-id'] ?? ''}:${delivery}`.slice(0, 200) : null,
      // Refunds arrive as order.updated (F9).
      ...(entity === 'order' ? { alsoPoll: ['creditNote' as const] } : {}),
    };
  }

  /**
   * Registers our webhooks, switches disabled ones back on (WooCommerce disables a webhook after
   * repeated failed deliveries) and removes ours that point at an old address.
   */
  async ensureWebhooks(): Promise<WebhookStatus[]> {
    const url = this.ctx.credentials.webhookUrl;
    if (!url) return [];
    const name = `Agentor ${(this.ctx.connectionId ?? '').slice(0, 8)}`.trim();
    let secret = this.ctx.credentials.webhookSecret;
    const fresh = !secret;
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      // Stored first: deliveries signed with it may arrive before this call returns.
      await this.ctx.persist?.({ webhookSecret: secret });
      this.ctx.credentials.webhookSecret = secret;
    }
    try {
      const hooks = await this.client.list<{
        id: number;
        name: string;
        topic: string;
        status: string;
        delivery_url: string;
      }>('/webhooks', { status: 'all' }, 500);
      const ours = hooks.filter((h) => h.name === name);
      for (const h of ours.filter((h) => h.delivery_url !== url))
        await this.client.request('DELETE', `/webhooks/${h.id}`, { query: { force: 'true' } });
      const out: WebhookStatus[] = [];
      for (const topic of WEBHOOK_TOPICS) {
        const hit = ours.find((h) => h.topic === topic && h.delivery_url === url);
        if (!hit) {
          await this.client.request('POST', '/webhooks', {
            body: { name, topic, delivery_url: url, secret, status: 'active' },
          });
          out.push({ topic, status: 'created' });
        } else if (hit.status !== 'active' || fresh) {
          await this.client.request('PUT', `/webhooks/${hit.id}`, {
            body: { status: 'active', secret },
          });
          out.push({ topic, status: hit.status !== 'active' ? 'reactivated' : 'active' });
        } else out.push({ topic, status: 'active' });
      }
      return out;
    } catch (e) {
      throw toWriteError(e);
    }
  }
}
