import { createHash, randomBytes } from 'node:crypto';
import {
  WriteError,
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
import {
  saleKeys,
  saleKind,
  type CreditNote,
  type Customer,
  type Entity,
  type EntityRecord,
  type InvoiceStatus,
  type Order,
  type OrderLine,
  type Product,
  type Stock,
} from '../model.js';
import { HttpError, ore, retryAfter, safeTransport, toWriteError, type Transport } from './http.js';

/**
 * e-conomic live client (PLAN-INTEGRATIONS-ECONOMIC). Two API families with the same two tokens
 * (E1, E4): REST for `/self`, master data, customers, products, booking and booked invoices;
 * OpenAPI for draft invoices (`externalId`), journal entries and webhooks. Invoice lines book
 * through products, and VAT follows the invoice's VAT zone × the product group (E5, E6).
 * Requests run one at a time per connection, as e-conomic asks (E15).
 */

export const ECONOMIC_REST = 'https://restapi.e-conomic.com';
export const ECONOMIC_APIS_URL = 'https://apis.e-conomic.com';
/** OpenAPI versions in one place: a version bump is a one-line change (E4). */
export const ECONOMIC_APIS = {
  q2c: 'q2capi/v6.0.0',
  journals: 'journalsapi/v16.0.1',
  webhooks: 'webhooksapi/v1.0.0',
} as const;
export type EconomicApi = keyof typeof ECONOMIC_APIS;

/** Installation URL (E2, EV1): the Tokens page of the app generates the authoritative one. */
export const ECONOMIC_INSTALL_URL = 'https://secure.e-conomic.com/secure/api1/requestaccess.aspx';

/**
 * Sides of journal amounts (E10, EV2): a customer payment credits the customer, and a sale
 * credits the revenue account, so both are negative. To be confirmed on a trial agreement.
 */
export const PAYMENT_SIGN = -1;
export const VOUCHER_SIGN = -1;

export const ECONOMIC_WEBHOOK_EVENTS = [
  'CUSTOMER_UPDATED',
  'PRODUCT_UPDATED',
  'INVOICE_BOOKED',
] as const;

/** The standard zones of a Danish agreement, used when the route maps none (§4.4). */
const STANDARD_ZONES: Record<string, number> = {
  'zones.domestic': 1,
  'zones.euB2b': 2,
  'zones.export': 3,
};

/** Our app at e-conomic: the secret is platform config, never a customer's credential (E1). */
export interface EconomicApp {
  appSecretToken: string;
  /** Base URLs; tests and staging point them elsewhere. */
  restUrl?: string;
  apisUrl?: string;
}

export function economicInstallUrl(c: {
  appPublicToken: string;
  redirectUrl: string;
  locale?: string;
  /** A URL with `{appPublicToken}`, `{redirectUrl}` and `{locale}` (ECONOMIC_INSTALL_URL). */
  template?: string;
}): string {
  const locale = c.locale ?? 'da-DK';
  if (c.template)
    return c.template
      .replace('{appPublicToken}', encodeURIComponent(c.appPublicToken))
      .replace('{redirectUrl}', encodeURIComponent(c.redirectUrl))
      .replace('{locale}', encodeURIComponent(locale));
  const u = new URL(ECONOMIC_INSTALL_URL);
  u.searchParams.set('appPublicToken', c.appPublicToken);
  u.searchParams.set('locale', locale);
  u.searchParams.set('redirectUrl', c.redirectUrl);
  return u.toString();
}

/* ---- Countries (E11): e-conomic keeps them as free text --------------------------------------- */

let countryIndex: {
  byName: Map<string, string>;
  da: Intl.DisplayNames;
  en: Intl.DisplayNames;
} | null = null;

function countries() {
  if (countryIndex) return countryIndex;
  const da = new Intl.DisplayNames(['da'], { type: 'region', fallback: 'none' });
  const en = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const byName = new Map<string, string>();
  const A = 65;
  for (let i = 0; i < 26; i++)
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      for (const n of [da.of(code), en.of(code)]) if (n) byName.set(n.toLowerCase(), code);
    }
  for (const [alias, code] of Object.entries({
    england: 'GB',
    'great britain': 'GB',
    uk: 'GB',
    usa: 'US',
    holland: 'NL',
    'the netherlands': 'NL',
  }))
    byName.set(alias, code);
  countryIndex = { byName, da, en };
  return countryIndex;
}

/** ISO 3166-1 alpha-2 from an e-conomic country ("Danmark", "Germany", "DK"); null if unknown. */
export function countryCode(name: string | null | undefined): string | null {
  const v = (name ?? '').trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return countries().byName.get(v.toLowerCase()) ?? null;
}

/** The country name e-conomic shows, in Danish or English (connection setting `countryNames`). */
export function countryName(code: string, lang: 'da' | 'en' = 'da'): string {
  const c = countries();
  return (lang === 'en' ? c.en : c.da).of(code.toUpperCase()) ?? code.toUpperCase();
}

/* ---- Small helpers ---------------------------------------------------------------------------- */

const kr = (o: number) => Math.round(o) / 100;
const isTrue = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d = '') =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : d;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const cut = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : undefined);
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);

/** A date as e-conomic wants it (YYYY-MM-DD), in Danish time. */
export function economicDate(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(
    Number.isNaN(d.getTime()) ? new Date() : d,
  );
}

/** A filter value with e-conomic's special characters escaped (`$ ( ) * , [ ]`). */
export function filterValue(v: string): string {
  return v.replace(/([$()*,[\]])/g, '$$$1').slice(0, 200);
}

/** ISO instant without milliseconds, as the `lastUpdated` filter takes it. */
const stamp = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

/* ---- Errors (E16) ----------------------------------------------------------------------------- */

/** e-conomic's own words from an error body (REST or problem+json), with its log id. */
export function economicMessage(e: HttpError): string {
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(e.body) as Record<string, unknown>;
  } catch {
    return e.message;
  }
  const msgs: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (msgs.length >= 3 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      o.forEach((x) => walk(x, path));
      return;
    }
    const r = o as Record<string, unknown>;
    if (typeof r.message === 'string' && (path || typeof r.property === 'string')) {
      const where = typeof r.property === 'string' ? r.property : path;
      msgs.push(`${where}: ${r.message}`);
      return;
    }
    for (const [k, v] of Object.entries(r))
      walk(v, path ? `${path}.${k}` : k === 'errors' ? '' : k);
  };
  walk(b.errors, '');
  const head = str(b.message) || str(b.detail) || str(b.title) || `HTTP ${e.status}`;
  const log = str(b.logId) || str(b.traceId);
  return [head, ...msgs].join(' · ').slice(0, 400) + (log ? ` (log ${log})` : '');
}

export function economicWriteError(e: unknown): WriteError {
  if (e instanceof WriteError) return e;
  if (e instanceof HttpError) {
    const msg = economicMessage(e);
    if (e.status === 401)
      // E02250: the grant was revoked in e-conomic (Indstillinger → Udvidelser → Apps).
      return new WriteError(`e-conomic refused the access: ${msg}`, 'unauthorized');
    if (e.status === 403)
      // A Basis agreement is read-only (E3), or the app's role lacks the module.
      return new WriteError(`e-conomic refused the write: ${msg}`, 'unauthorized');
    if (e.status === 409) return new WriteError(`e-conomic conflict: ${msg}`, 'transient', 5_000);
    if (e.status === 429) return new WriteError(msg, 'rate_limited', e.retryAfterMs ?? 60_000);
    if (e.status >= 400 && e.status < 500) return new WriteError(msg, 'invalid');
    return new WriteError(msg, 'transient');
  }
  return toWriteError(e);
}

/* ---- Client ----------------------------------------------------------------------------------- */

export interface EconomicContext extends AdapterContext {
  app?: EconomicApp;
  transport?: Transport;
  connectionId?: string;
  now?: () => number;
}

interface RestPage<T> {
  collection?: T[];
  pagination?: { results?: number; nextPage?: string };
}

export class EconomicClient {
  constructor(private readonly ctx: EconomicContext) {}

  private get transport() {
    return this.ctx.transport ?? safeTransport;
  }

  private async send<T>(
    url: URL,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    opts: { body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const secret = this.ctx.app?.appSecretToken;
    if (!secret)
      throw new WriteError('the e-conomic app secret token is not configured', 'unauthorized');
    const grant = this.ctx.credentials.grantToken;
    if (!grant) throw new WriteError('the e-conomic connection has no grant token', 'unauthorized');
    const res = await this.transport(url.toString(), {
      method,
      headers: {
        'x-appsecrettoken': secret,
        'x-agreementgranttoken': grant,
        accept: 'application/json',
        // e-conomic answers 415 to anything but JSON, also on GET (E1).
        'content-type': 'application/json',
        ...(opts.idempotencyKey && method !== 'GET'
          ? { 'idempotency-key': opts.idempotencyKey }
          : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (res.status >= 400)
      throw new HttpError(
        res.status,
        res.body.slice(0, 2000),
        res.status === 429 ? retryAfter(res.headers, 60_000) : null,
      );
    return (res.body ? JSON.parse(res.body) : null) as T;
  }

  private url(base: string, path: string, query?: Record<string, string | number | undefined>) {
    const u = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
    for (const [k, v] of Object.entries(query ?? {}))
      if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u;
  }

  rest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    return this.send<T>(
      this.url(this.ctx.app?.restUrl ?? ECONOMIC_REST, path, opts.query),
      method,
      opts,
    );
  }

  api<T>(
    api: EconomicApi,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const base = `${(this.ctx.app?.apisUrl ?? ECONOMIC_APIS_URL).replace(/\/$/, '')}/${ECONOMIC_APIS[api]}`;
    return this.send<T>(this.url(base, path, opts.query), method, opts);
  }

  /** A REST collection, page by page (`skippages`, at most 1000 per page). */
  async restList<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    limit: number,
  ): Promise<T[]> {
    const size = Math.max(1, Math.min(1000, limit));
    const out: T[] = [];
    for (let page = 0; out.length < limit; page++) {
      const res = await this.rest<RestPage<T>>('GET', path, {
        query: { ...query, pagesize: size, skippages: page },
      });
      const rows = res?.collection ?? [];
      out.push(...rows);
      if (rows.length < size || !res?.pagination?.nextPage) break;
    }
    return out.slice(0, limit);
  }

  /** An OpenAPI collection, following the cursor. */
  async apiList<T>(
    api: EconomicApi,
    path: string,
    query: Record<string, string | number | undefined>,
    limit: number,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.api<{ items?: T[]; cursor?: string }>(api, 'GET', path, {
        query: { ...query, ...(cursor ? { cursor } : {}) },
      });
      out.push(...(res?.items ?? []));
      cursor = res?.cursor || undefined;
    } while (cursor && out.length < limit);
    return out.slice(0, limit);
  }
}

/* ---- e-conomic shapes ------------------------------------------------------------------------- */

interface EcoCustomer {
  customerNumber: number;
  name: string;
  email?: string;
  mobilePhone?: string;
  telephoneAndFaxNumber?: string;
  address?: string;
  zip?: string;
  city?: string;
  country?: string;
  corporateIdentificationNumber?: string;
  vatNumber?: string;
  ean?: string;
  lastUpdated?: string;
  barred?: boolean;
  currency?: string;
  customerGroup?: { customerGroupNumber: number; name?: string };
  paymentTerms?: { paymentTermsNumber: number };
  vatZone?: { vatZoneNumber: number };
  [k: string]: unknown;
}

interface EcoProduct {
  productNumber: string;
  name: string;
  salesPrice?: number;
  barCode?: string;
  barred?: boolean;
  lastUpdated?: string;
  productGroup?: { productGroupNumber: number; name?: string; inventoryEnabled?: boolean };
  inventory?: { available?: number; inStock?: number };
}

interface EcoBooked {
  bookedInvoiceNumber: number;
  date?: string;
  dueDate?: string;
  currency?: string;
  grossAmount?: number;
  remainder?: number;
  customer?: { customerNumber: number };
  recipient?: { name?: string; vatZone?: { vatZoneNumber: number } };
  references?: { other?: string };
  notes?: { heading?: string };
}

interface Q2cDraft {
  number: number;
  draftInvoiceNumber?: number;
  customerNumber?: number;
  externalId?: string;
  isVatIncluded?: boolean;
  amount?: number;
  vatAmount?: number;
  roundingAmount?: number;
  objectVersion?: string;
}

interface Q2cLine {
  number?: number;
  productNumber: string;
  description: string;
  quantity: number;
  unitNetPrice: number;
  discountPercentage?: number;
  unitNumber?: number;
}

/** Fields a REST customer PUT keeps when we don't set them (PUT is a full replace, E16). */
const CUSTOMER_KEEP = [
  'customerNumber',
  'name',
  'currency',
  'customerGroup',
  'paymentTerms',
  'vatZone',
  'address',
  'zip',
  'city',
  'country',
  'email',
  'mobilePhone',
  'telephoneAndFaxNumber',
  'corporateIdentificationNumber',
  'pNumber',
  'vatNumber',
  'ean',
  'publicEntryNumber',
  'website',
  'creditLimit',
  'barred',
  'layout',
  'salesPerson',
  'priceGroup',
  'attention',
  'customerContact',
  'defaultDeliveryLocation',
  'eInvoicingDisabledByDefault',
];

/* ---- Normalising (source side, §5) ------------------------------------------------------------ */

export function toCustomer(c: EcoCustomer): Customer {
  const id = (c.corporateIdentificationNumber ?? '').replace(/\s/g, '');
  const euVat = /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(id) ? id : null;
  const cvr = /^\d{8}$/.test(id) ? id : null;
  const company = Boolean(id);
  return {
    sourceId: String(c.customerNumber),
    kind: company ? 'company' : 'person',
    name: c.name,
    email: c.email?.split(/[;,]/)[0]?.trim() || null,
    phone: c.mobilePhone || c.telephoneAndFaxNumber || null,
    vatNumber: c.vatNumber || euVat || (cvr ? `DK${cvr}` : null),
    address: {
      line1: c.address ?? null,
      postalCode: c.zip ?? null,
      city: c.city ?? null,
      country: countryCode(c.country) ?? 'DK',
    },
    companyName: company ? c.name : null,
    cvr,
    ean: c.ean ?? null,
    ...(c.lastUpdated ? { updatedAt: c.lastUpdated } : {}),
  };
}

export function toProduct(p: EcoProduct): Product {
  return {
    sourceId: p.productNumber,
    sku: p.productNumber,
    name: p.name,
    category: p.productGroup?.name ?? null,
    price: ore(p.salesPrice ?? 0),
    // e-conomic products carry no VAT: the invoice's zone decides it (E6).
    vatRate: 0,
    ean: p.barCode ?? null,
    ...(p.lastUpdated ? { updatedAt: p.lastUpdated } : {}),
    raw: p,
  };
}

/** Stock from a product (E12). No change time: the record's content is its version (E14). */
export function toStock(
  p: EcoProduct,
  settings: { quantity?: unknown; safetyBuffer?: unknown } = {},
): Stock {
  const field = settings.quantity === 'inStock' ? 'inStock' : 'available';
  const buffer = Number(settings.safetyBuffer ?? 0) || 0;
  const qty = Math.floor(Number(p.inventory?.[field] ?? 0)) - Math.max(0, buffer);
  return { sourceId: p.productNumber, sku: p.productNumber, quantity: Math.max(0, qty) };
}

/** Patterns typed into the connection settings run in the worker: bounded and backtracking-safe. */
const PATTERN_MAX = 100;
const REFERENCE_MAX = 120;
// A quantified group that is itself quantified ("(a+)+", "(\d*)*", "(x+){2,}") or a back-reference
// can backtrack exponentially; those patterns are refused and the whole reference is used.
const UNSAFE_PATTERN = /\([^)]*[+*}][^)]*\)\s*[+*{]|\\[1-9]/;
const patternCache = new Map<string, RegExp | null>();

export function orderRefRegExp(pattern: string): RegExp | null {
  if (patternCache.has(pattern)) return patternCache.get(pattern)!;
  let re: RegExp | null = null;
  if (pattern.length <= PATTERN_MAX && !UNSAFE_PATTERN.test(pattern)) {
    try {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- length-capped, nested quantifiers and back-references refused above, run on a capped string.
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
  }
  patternCache.set(pattern, re);
  return re;
}

/** Where a booked invoice stands (§5.1). Versioned by content, so a payment is a new version. */
export function toInvoiceStatus(b: EcoBooked, orderRefPattern = ''): InvoiceStatus {
  const gross = b.grossAmount ?? 0;
  const total = Math.abs(ore(gross));
  const residual = Math.abs(ore(b.remainder ?? 0));
  const other = (b.references?.other ?? '').trim();
  let orderRef: string | null = other || null;
  const re = other && orderRefPattern ? orderRefRegExp(orderRefPattern) : null;
  if (re) {
    const m = re.exec(other.slice(0, REFERENCE_MAX));
    orderRef = m ? (m[1] ?? m[0]) : null;
  }
  return {
    sourceId: String(b.bookedInvoiceNumber),
    kind: gross < 0 ? 'creditNote' : 'invoice',
    number: String(b.bookedInvoiceNumber),
    orderRef,
    orderSource: null,
    state: 'posted',
    paymentState: residual === 0 ? 'paid' : residual < total ? 'partial' : 'notPaid',
    currency: b.currency ?? 'DKK',
    total,
    residual,
    date: b.date ?? null,
    dueDate: b.dueDate ?? null,
    raw: b,
  };
}

/* ---- Adapter ---------------------------------------------------------------------------------- */

interface RouteContext {
  settings: Record<string, unknown>;
  mapping: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
  accounts: (string | null)[];
}

function routeOf(opts: WriteOptions): RouteContext {
  return {
    settings: opts.route?.settings ?? {},
    mapping: opts.route?.mapping ?? {},
    tables: opts.route?.tables ?? {},
    accounts: opts.route?.accounts ?? [],
  };
}

type Warning = NonNullable<WriteResult['warnings']>[number];

/** What a document is in e-conomic: a draft (Q2C number) or a booked invoice. */
type Found =
  | { kind: 'draft'; number: number; draft: Q2cDraft }
  | { kind: 'booked'; number: number; booked: EcoBooked };

export class EconomicAdapter implements ConnectorAdapter {
  readonly connectorId = 'economic';
  private readonly client: EconomicClient;
  /** Per adapter (one run): product numbers by SKU/EAN, and lists read once. */
  private readonly productCache = new Map<string, string | null>();
  private zonesCache: { vatZoneNumber: number; name: string }[] | null = null;
  private accountVat: Map<string, string> | null = null;
  private selfCache: Record<string, unknown> | null = null;

  constructor(private readonly ctx: EconomicContext) {
    if (!ctx.credentials.grantToken)
      throw new WriteError('e-conomic credentials are incomplete', 'unauthorized');
    this.client = new EconomicClient(ctx);
  }

  /** A connection setting (L1). */
  private conn(key: string): unknown {
    return this.ctx.settings?.[key];
  }

  /* -- Connection test (§4.1) -- */

  private async self(): Promise<Record<string, unknown>> {
    this.selfCache ??= await this.client.rest<Record<string, unknown>>('GET', '/self');
    return this.selfCache;
  }

  async test(): Promise<TestResult> {
    try {
      const s = await this.self();
      const agreement = String(s.agreementNumber ?? '');
      const company = (s.company as { name?: string } | undefined)?.name ?? `Aftale ${agreement}`;
      const plan = String(
        (s.agreementType as { subscriptionPlanLevel?: string } | undefined)
          ?.subscriptionPlanLevel ?? '',
      ).toLowerCase();
      const patch: Record<string, string> = {
        agreementNumber: agreement,
        planLevel: plan,
        canSendElectronicInvoice: String(s.canSendElectronicInvoice === true),
        baseCurrency: String(
          (s.settings as { baseCurrency?: string } | undefined)?.baseCurrency ?? 'DKK',
        ),
      };
      const c = this.ctx.credentials;
      if (Object.entries(patch).some(([k, v]) => c[k] !== v)) {
        Object.assign(c, patch);
        await this.ctx.persist?.(patch);
      }
      return { ok: true, account: { id: agreement, name: company } };
    } catch (e) {
      const w = economicWriteError(e);
      if (w.kind === 'unauthorized')
        return {
          ok: false,
          reason: 'unauthorized',
          message:
            'e-conomic afviste adgangen. Forbind igen, eller tjek at appen stadig er tilføjet.',
        };
      if (w.kind === 'transient' || w.kind === 'rate_limited')
        return { ok: false, reason: 'unreachable', message: 'e-conomic svarede ikke.' };
      return { ok: false, reason: 'unknown', message: w.message.slice(0, 200) };
    }
  }

  /* -- Lookups (X1) -- */

  async lookup(list: LookupId): Promise<LookupOption[]> {
    const c = this.client;
    if (list === 'layouts') {
      const rows = await c.restList<{ layoutNumber: number; name: string; deleted?: boolean }>(
        '/layouts',
        {},
        1000,
      );
      return rows
        .filter((r) => !r.deleted)
        .map((r) => ({ value: String(r.layoutNumber), label: r.name }));
    }
    if (list === 'vatZones') {
      const rows = await this.zones();
      return rows.map((r) => ({ value: String(r.vatZoneNumber), label: r.name }));
    }
    if (list === 'paymentTerms') {
      const rows = await c.restList<{
        paymentTermsNumber: number;
        name: string;
        paymentTermsType?: string;
        daysOfCredit?: number;
      }>('/payment-terms', {}, 1000);
      return rows.map((r) => ({
        value: String(r.paymentTermsNumber),
        label: r.name,
        meta: { type: r.paymentTermsType ?? '', days: r.daysOfCredit ?? 0 },
      }));
    }
    if (list === 'customerGroups') {
      const rows = await c.restList<{ customerGroupNumber: number; name: string }>(
        '/customer-groups',
        {},
        1000,
      );
      return rows.map((r) => ({ value: String(r.customerGroupNumber), label: r.name }));
    }
    if (list === 'productGroups') {
      const rows = await c.restList<{
        productGroupNumber: number;
        name: string;
        inventoryEnabled?: boolean;
      }>('/product-groups', {}, 1000);
      return rows.map((r) => ({
        value: String(r.productGroupNumber),
        label: r.name,
        meta: { inventory: r.inventoryEnabled === true },
      }));
    }
    if (list === 'units') {
      const rows = await c.restList<{ unitNumber: number; name: string }>('/units', {}, 1000);
      return rows.map((r) => ({ value: String(r.unitNumber), label: r.name }));
    }
    if (list === 'journals') {
      const rows = await c.restList<{
        journalNumber: number;
        name: string;
        settings?: { entryTypeRestrictedTo?: string };
      }>('/journals', {}, 1000);
      return rows.map((r) => ({
        value: String(r.journalNumber),
        label: r.name,
        ...(r.settings?.entryTypeRestrictedTo
          ? { meta: { restrictedTo: r.settings.entryTypeRestrictedTo } }
          : {}),
      }));
    }
    if (list === 'accounts') {
      const rows = await this.accounts();
      return rows.map((a) => ({
        value: String(a.accountNumber),
        label: a.name,
        ...(a.vatAccount?.vatCode ? { vatCode: a.vatAccount.vatCode } : {}),
      }));
    }
    if (list === 'vatCodes') {
      const rows = await c.restList<{ vatCode: string; name: string; ratePercentage?: number }>(
        '/vat-accounts',
        {},
        1000,
      );
      return rows.map((r) => ({
        value: r.vatCode,
        label: `${r.vatCode} · ${r.name}`,
        meta: { rate: r.ratePercentage ?? 0 },
      }));
    }
    if (list === 'products') {
      const rows = await c.restList<EcoProduct>('/products', { filter: 'barred$eq:false' }, 1000);
      return rows.map((p) => ({ value: p.productNumber, label: `${p.productNumber} · ${p.name}` }));
    }
    return [];
  }

  private async zones() {
    this.zonesCache ??= (
      await this.client.restList<{
        vatZoneNumber: number;
        name: string;
        enabledForCustomer?: boolean;
      }>('/vat-zones', {}, 1000)
    ).filter((z) => z.enabledForCustomer !== false);
    return this.zonesCache;
  }

  private async accounts() {
    const rows = await this.client.restList<{
      accountNumber: number;
      name: string;
      accountType?: string;
      barred?: boolean;
      vatAccount?: { vatCode?: string };
    }>('/accounts', {}, 5000);
    // Headings and sums can't take entries.
    return rows.filter(
      (a) => !a.barred && (!a.accountType || ['profitAndLoss', 'status'].includes(a.accountType)),
    );
  }

  async count(entity: Entity): Promise<number | null> {
    const path =
      entity === 'customer'
        ? '/customers'
        : entity === 'product'
          ? '/products'
          : entity === 'invoiceStatus'
            ? '/invoices/booked'
            : null;
    if (!path) return null;
    const res = await this.client.rest<RestPage<unknown>>('GET', path, { query: { pagesize: 1 } });
    const n = res?.pagination?.results;
    return typeof n === 'number' ? n : null;
  }

  /* -- Source (§5) -- */

  async fetch<E extends Entity>(entity: E, opts: FetchOptions): Promise<EntityRecord[E][]> {
    try {
      const since = opts.since ? `lastUpdated$gte:${stamp(opts.since)}` : undefined;
      if (entity === 'customer') {
        const rows = await this.client.restList<EcoCustomer>(
          '/customers',
          { ...(since ? { filter: since } : {}), sort: 'lastUpdated' },
          opts.limit,
        );
        return rows.map(toCustomer) as EntityRecord[E][];
      }
      if (entity === 'product') {
        const filter = ['barred$eq:false', since].filter(Boolean).join('$and:');
        const rows = await this.client.restList<EcoProduct>(
          '/products',
          { filter, sort: 'lastUpdated' },
          opts.limit,
        );
        return rows.map(toProduct) as EntityRecord[E][];
      }
      if (entity === 'stock') return (await this.fetchStock(opts)) as EntityRecord[E][];
      if (entity === 'invoiceStatus') {
        const days = Number(this.conn('invoiceStatus.days') ?? 90) || 90;
        const now = this.ctx.now?.() ?? Date.now();
        const from = economicDate(new Date(now - days * 86_400_000).toISOString());
        const rows = await this.client.restList<EcoBooked>(
          '/invoices/booked',
          { filter: `date$gte:${from}`, sort: '-bookedInvoiceNumber' },
          opts.limit,
        );
        const pattern = str(this.conn('invoiceStatus.orderRefPattern'));
        return rows.map((b) => toInvoiceStatus(b, pattern)) as EntityRecord[E][];
      }
      return [];
    } catch (e) {
      throw economicWriteError(e);
    }
  }

  /** Products in groups with the Inventory module (E12); all of them unless `stock.scan` = changed. */
  private async fetchStock(opts: FetchOptions): Promise<Stock[]> {
    const groups = (
      await this.client.restList<{ productGroupNumber: number; inventoryEnabled?: boolean }>(
        '/product-groups',
        {},
        1000,
      )
    )
      .filter((g) => g.inventoryEnabled)
      .map((g) => g.productGroupNumber)
      .slice(0, 200);
    if (groups.length === 0) return [];
    const parts = ['barred$eq:false', `productGroup.productGroupNumber$in:[${groups.join(',')}]`];
    if (this.conn('stock.scan') === 'changed' && opts.since)
      parts.push(`lastUpdated$gte:${stamp(opts.since)}`);
    const rows = await this.client.restList<EcoProduct>(
      '/products',
      { filter: parts.join('$and:') },
      opts.limit,
    );
    return rows.map((p) =>
      toStock(p, {
        quantity: this.conn('stock.quantity'),
        safetyBuffer: this.conn('stock.safetyBuffer'),
      }),
    );
  }

  async get<E extends Entity>(entity: E, sourceId: string): Promise<EntityRecord[E] | null> {
    try {
      if (entity === 'customer' && /^\d{1,9}$/.test(sourceId))
        return toCustomer(
          await this.client.rest<EcoCustomer>('GET', `/customers/${sourceId}`),
        ) as EntityRecord[E];
      if (entity === 'invoiceStatus' && /^\d{1,9}$/.test(sourceId))
        return toInvoiceStatus(
          await this.client.rest<EcoBooked>('GET', `/invoices/booked/${sourceId}`),
          str(this.conn('invoiceStatus.orderRefPattern')),
        ) as EntityRecord[E];
      if (entity === 'product' || entity === 'stock') {
        // Product numbers may hold characters the URL path encodes its own way (§9 gotcha 16).
        const [p] = await this.client.restList<EcoProduct>(
          '/products',
          { filter: `productNumber$eq:${filterValue(sourceId)}` },
          1,
        );
        if (!p) return null;
        return (
          entity === 'product'
            ? toProduct(p)
            : toStock(p, {
                quantity: this.conn('stock.quantity'),
                safetyBuffer: this.conn('stock.safetyBuffer'),
              })
        ) as EntityRecord[E];
      }
      return null;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw economicWriteError(e);
    }
  }

  /* -- Webhooks (§5.4) -- */

  parseWebhook(rawBody: string): WebhookChange | null {
    let b: { event?: unknown; old?: unknown; new?: unknown; invoice?: unknown };
    try {
      b = JSON.parse(rawBody) as typeof b;
    } catch {
      return null;
    }
    // A merge field e-conomic didn't fill stays as "[NAME]".
    const id = (v: unknown) =>
      typeof v === 'string' && v && !v.startsWith('[')
        ? v.slice(0, 50)
        : typeof v === 'number'
          ? String(v)
          : null;
    const event = String(b.event ?? '');
    if (event === 'INVOICE_BOOKED') {
      const n = id(b.invoice) ?? id(b.new);
      return n ? { entity: 'invoiceStatus', sourceIds: [n], deliveryId: null } : null;
    }
    const n = id(b.new) ?? id(b.old);
    if (!n) return null;
    if (event === 'CUSTOMER_UPDATED')
      return { entity: 'customer', sourceIds: [n], deliveryId: null };
    if (event === 'PRODUCT_UPDATED')
      return { entity: 'product', sourceIds: [n], deliveryId: null, alsoPoll: ['stock'] };
    return null;
  }

  /**
   * Registers our three webhooks with the connection's secret in a header, and switches disabled
   * ones back on (E13: e-conomic disables a hook after 250 failures in 24 h and queues nothing).
   */
  async ensureWebhooks(): Promise<WebhookStatus[]> {
    const url = this.ctx.credentials.webhookUrl;
    if (!url || this.conn('webhooks.mode') === 'poll') return [];
    let secret = this.ctx.credentials.webhookSecret;
    const fresh = !secret;
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      await this.ctx.persist?.({ webhookSecret: secret });
      this.ctx.credentials.webhookSecret = secret;
    }
    const out: WebhookStatus[] = [];
    for (const eventType of ECONOMIC_WEBHOOK_EVENTS) {
      const body = {
        eventType,
        name: `Agentor ${(this.ctx.connectionId ?? '').slice(0, 8)}`.trim(),
        url,
        contentType: 'application/json',
        postData: JSON.stringify({
          event: eventType,
          old: '[OLDNUMBER]',
          new: '[NEWNUMBER]',
          ...(eventType === 'INVOICE_BOOKED' ? { invoice: '[INVOICENO]' } : {}),
        }),
        customHeaders: [{ key: 'X-Agentor-Secret', value: secret }],
        isDisabled: false,
      };
      try {
        let current: { url?: string; isDisabled?: boolean; objectVersion?: string } | null = null;
        try {
          current = await this.client.api('webhooks', 'GET', `/webhooks/${eventType}`);
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 404)) throw e;
        }
        if (!current) {
          await this.client.api('webhooks', 'POST', '/webhooks', { body });
          out.push({ topic: eventType, status: 'created' });
        } else if (current.isDisabled || current.url !== url || fresh) {
          await this.client.api('webhooks', 'PUT', '/webhooks', {
            body: { ...body, objectVersion: current.objectVersion },
          });
          out.push({ topic: eventType, status: current.isDisabled ? 'reactivated' : 'active' });
        } else out.push({ topic: eventType, status: 'active' });
      } catch (e) {
        const w = economicWriteError(e);
        if (w.kind !== 'invalid') throw w;
        // Another app owns the event type on this agreement (one hook per event, E13).
        out.push({ topic: eventType, status: 'missing' });
      }
    }
    return out;
  }

  /* -- Destination (§4) -- */

  async write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: WriteOptions,
  ): Promise<WriteResult> {
    try {
      if (opts.mode !== 'dry_run' && this.ctx.credentials.planLevel === 'basis')
        throw new WriteError(
          'the e-conomic agreement is on the Basis plan, which is read-only (Plus or higher is needed)',
          'unauthorized',
        );
      if (entity === 'customer') return await this.writeCustomer(record as Customer, opts);
      if (entity === 'product') return await this.writeProduct(record as Product, opts);
      if (entity === 'order')
        return routeOf(opts).settings['posting.type'] === 'journal'
          ? await this.writeJournal(record as Order, opts)
          : await this.writeInvoice(record as Order, opts);
      if (entity === 'creditNote') return await this.writeCreditNote(record as CreditNote, opts);
      throw new WriteError(`e-conomic does not receive ${entity}`, 'invalid');
    } catch (e) {
      throw economicWriteError(e);
    }
  }

  private idem(...parts: (string | number)[]) {
    return `agentor-${hash([this.ctx.connectionId ?? '', ...parts])}`;
  }

  /* -- Customers (§4.3 Kunder) -- */

  private async findCustomer(filter: string): Promise<EcoCustomer | null> {
    const [hit] = await this.client.restList<EcoCustomer>('/customers', { filter }, 1);
    return hit ?? null;
  }

  private async getCustomer(n: number): Promise<EcoCustomer | null> {
    try {
      return await this.client.rest<EcoCustomer>('GET', `/customers/${n}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  private async writeCustomer(c: Customer, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const s = r.settings;
    const match = str(s['contact.match'], 'email');
    if (match === 'none') {
      const shared = num(s['contact.shared']);
      if (!shared)
        throw new WriteError('choose the shared e-conomic customer (contact.shared)', 'invalid');
      return { action: 'skip', destinationId: String(shared) };
    }
    const fromShop = /^\d{1,9}$/.test(c.sourceId)
      ? Number(c.sourceId) + (Number(s['contact.numberOffset'] ?? 0) || 0)
      : null;
    let found: EcoCustomer | null = null;
    const known = num(opts.existingId);
    if (known) found = await this.getCustomer(known);
    if (!found && match === 'email' && c.email)
      found = await this.findCustomer(`email$eq:${filterValue(c.email)}`);
    if (!found && match === 'cvr' && (c.cvr || c.vatNumber))
      found = await this.findCustomer(
        `corporateIdentificationNumber$eq:${filterValue((c.cvr || c.vatNumber)!)}`,
      );
    if (!found && match === 'number' && fromShop && fromShop < 1e9)
      found = await this.getCustomer(fromShop);
    if (opts.mode === 'dry_run')
      return { action: found ? 'update' : 'create', destinationId: null };

    const lang = this.conn('countryNames') === 'en' ? 'en' : 'da';
    const company = c.kind === 'company';
    const values: Record<string, unknown> = {
      name: cut(
        opts.fields?.['customer.name'] || (company ? c.companyName || c.name : c.name),
        255,
      ),
      address: cut([c.address.line1, c.address.line2].filter(Boolean).join(', '), 510),
      zip: cut(c.address.postalCode, 30),
      city: cut(c.address.city, 50),
      country: c.address.country ? countryName(c.address.country, lang).slice(0, 50) : undefined,
      email: cut(c.email, 255),
      mobilePhone: cut(c.phone, 50),
      corporateIdentificationNumber: company ? cut(c.cvr || c.vatNumber, 40) : undefined,
      ean: company ? cut(c.ean, 13) : undefined,
    };

    if (found) {
      const chosen = Array.isArray(s['contact.update'])
        ? (s['contact.update'] as string[])
        : ['name', 'address', 'zip', 'city', 'country', 'email', 'phone', 'ean'];
      const FIELD: Record<string, string> = {
        phone: 'mobilePhone',
        cvr: 'corporateIdentificationNumber',
      };
      const patch: Record<string, unknown> = {};
      for (const k of chosen) {
        const key = FIELD[k] ?? k;
        if (values[key] !== undefined && values[key] !== found[key]) patch[key] = values[key];
      }
      if (Object.keys(patch).length === 0)
        return { action: 'skip', destinationId: String(found.customerNumber) };
      // REST PUT replaces the customer: keep everything we don't own.
      const current = Object.fromEntries(
        CUSTOMER_KEEP.filter((k) => found![k] !== undefined).map((k) => [k, found![k]]),
      );
      await this.client.rest('PUT', `/customers/${found.customerNumber}`, {
        body: { ...current, ...patch },
      });
      return { action: 'update', destinationId: String(found.customerNumber) };
    }

    const foreign = saleKind({ customer: c }) !== 'domestic';
    const group =
      num(foreign ? s['contact.groupForeign'] : undefined) ??
      num(s['contact.group']) ??
      num(this.conn('customerGroup')) ??
      1;
    const terms = await this.defaultTerms(s);
    const zone = await this.zoneFor({ customer: c }, r);
    const body = {
      ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '')),
      ...(match === 'number' && fromShop && fromShop < 1e9 ? { customerNumber: fromShop } : {}),
      currency: this.ctx.credentials.baseCurrency || 'DKK',
      customerGroup: { customerGroupNumber: group },
      paymentTerms: { paymentTermsNumber: terms },
      vatZone: { vatZoneNumber: zone },
    };
    const created = await this.client.rest<EcoCustomer>('POST', '/customers', {
      body,
      idempotencyKey: this.idem('customer', c.sourceId, hash(body)),
    });
    const n = created.customerNumber;
    // The buyer at a company as the invoice's attention person (§4.3 contact.attention).
    if (
      company &&
      isTrue(s['contact.attention'], true) &&
      c.companyName &&
      c.name !== c.companyName
    ) {
      const contact = await this.client.rest<{ customerContactNumber: number }>(
        'POST',
        `/customers/${n}/contacts`,
        {
          body: {
            name: c.name.slice(0, 255),
            ...(c.email ? { email: c.email.slice(0, 255) } : {}),
          },
          idempotencyKey: this.idem('contact', n, c.name),
        },
      );
      if (contact?.customerContactNumber) {
        const current = Object.fromEntries(
          CUSTOMER_KEEP.filter((k) => created[k] !== undefined).map((k) => [k, created[k]]),
        );
        await this.client.rest('PUT', `/customers/${n}`, {
          body: { ...current, attention: { customerContactNumber: contact.customerContactNumber } },
        });
      }
    }
    return { action: 'create', destinationId: String(n) };
  }

  /** Payment terms for new customers and unpaid orders: route, connection, then the agreement's. */
  private async defaultTerms(s: Record<string, unknown>): Promise<number> {
    const set = num(s['paymentTerms.unpaid']) ?? num(this.conn('paymentTerms'));
    if (set) return set;
    const self = await this.self();
    return (
      num((self.settings as { defaultPaymentTerm?: unknown } | undefined)?.defaultPaymentTerm) ?? 1
    );
  }

  /* -- VAT zones (E6, §4.4 table 1) -- */

  private async zoneFor(
    o: Pick<Order, 'customer'> & Partial<Pick<Order, 'lines' | 'vatLines'>>,
    r: RouteContext,
  ): Promise<number> {
    const kind = saleKind(o);
    const oss = r.settings['oss.mode'] === 'destinationVat';
    if (kind === 'euB2c' && oss) {
      const country = o.customer.address.country.toUpperCase();
      const row = (r.tables.ossZones ?? []).find((x) => x.from === country);
      const fromTable = num(row?.zone);
      if (fromTable) return fromTable;
      const names = new Set(
        [countryName(country, 'en'), countryName(country, 'da')].map((n) => n.toLowerCase()),
      );
      const zone = (await this.zones()).find((z) => names.has(z.name.toLowerCase()));
      if (zone) return zone.vatZoneNumber;
      const mapped = num(r.mapping['zones.euB2c']);
      if (mapped) return mapped;
      throw new WriteError(`no e-conomic VAT zone for ${country} (OSS-zoner)`, 'invalid');
    }
    const keys = saleKeys(kind, 0.25, false, oss, 'zones.');
    for (const k of keys) {
      const v = num(r.mapping[k]);
      if (v) return v;
    }
    for (const k of [...keys, 'zones.domestic']) if (STANDARD_ZONES[k]) return STANDARD_ZONES[k]!;
    return 1;
  }

  /* -- Products (§4.3, §4.4 table 2) -- */

  private async productNumberBy(field: 'productNumber' | 'barCode', value: string) {
    const key = `${field}:${value}`;
    if (this.productCache.has(key)) return this.productCache.get(key) ?? null;
    const [p] = await this.client.restList<EcoProduct>(
      '/products',
      { filter: `${field}$eq:${filterValue(value)}$and:barred$eq:false` },
      1,
    );
    const n = p?.productNumber ?? null;
    this.productCache.set(key, n);
    return n;
  }

  /** The e-conomic product an order line books through (E5). */
  private async productFor(l: OrderLine, r: RouteContext, dry: boolean): Promise<string> {
    const s = r.settings;
    const generic = () => {
      const services = l.supplyType === 'services';
      const fee = l.kind === 'fee' ? r.mapping['products.fees'] : '';
      const p =
        fee ||
        (services ? r.mapping['products.genericServices'] : '') ||
        r.mapping['products.generic'];
      if (!p)
        throw new WriteError(
          `no e-conomic product for "${l.name}": choose a standard product (Varer → Standardvare)`,
          'invalid',
        );
      return p;
    };
    if (l.kind === 'fee' && r.mapping['products.fees']) return r.mapping['products.fees'];
    const match = str(s['products.match'], 'sku');
    if (match === 'none') return generic();
    const value = match === 'barcode' ? l.ean : l.sku;
    if (value) {
      const n = await this.productNumberBy(
        match === 'barcode' ? 'barCode' : 'productNumber',
        value,
      );
      if (n) return n;
    }
    const missing = str(s['products.missing'], 'useGeneric');
    if (missing === 'fail')
      throw new WriteError(`the product ${value ?? l.name} is not in e-conomic`, 'invalid');
    if (missing === 'create' && l.sku) {
      if (l.sku.length > 25)
        throw new WriteError(
          `the SKU ${l.sku} is longer than e-conomic's 25 characters`,
          'invalid',
        );
      const row = (r.tables.productGroups ?? []).find((x) => x.from === l.category);
      const group = num(row?.group) ?? num(s['products.group']);
      if (!group)
        throw new WriteError(`choose a product group for new products (products.group)`, 'invalid');
      if (!dry) {
        await this.client.rest('POST', '/products', {
          body: {
            productNumber: l.sku,
            name: l.name.slice(0, 300),
            productGroup: { productGroupNumber: group },
            salesPrice: kr(l.unitPrice),
            ...(l.ean ? { barCode: l.ean.slice(0, 50) } : {}),
            ...(num(s['lines.unit']) ? { unit: { unitNumber: num(s['lines.unit']) } } : {}),
          },
          idempotencyKey: this.idem('product', l.sku),
        });
        this.productCache.set(`productNumber:${l.sku}`, l.sku);
      }
      return l.sku;
    }
    return generic();
  }

  private async writeProduct(p: Product, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const s = r.settings;
    const sku = opts.existingId || p.sku;
    if (!sku) throw new WriteError(`the product "${p.name}" has no SKU`, 'invalid');
    if (sku.length > 25)
      throw new WriteError(`the SKU ${sku} is longer than e-conomic's 25 characters`, 'invalid');
    const [current] = await this.client.restList<EcoProduct & Record<string, unknown>>(
      '/products',
      { filter: `productNumber$eq:${filterValue(sku)}` },
      1,
    );
    if (opts.mode === 'dry_run')
      return { action: current ? 'update' : 'create', destinationId: null };
    const name = (opts.fields?.['product.name'] || p.name).slice(0, 300);
    if (current) {
      if (!isTrue(s['product.update'], true)) return { action: 'skip', destinationId: sku };
      const fields = Array.isArray(s['product.fields'])
        ? (s['product.fields'] as string[])
        : ['name', 'barcode'];
      const patch: Record<string, unknown> = {};
      if (fields.includes('name') && current.name !== name) patch.name = name;
      if (fields.includes('price') && ore(current.salesPrice ?? 0) !== p.price)
        patch.salesPrice = kr(p.price);
      if (fields.includes('barcode') && p.ean && current.barCode !== p.ean)
        patch.barCode = p.ean.slice(0, 50);
      if (Object.keys(patch).length === 0) return { action: 'skip', destinationId: sku };
      const keep = Object.fromEntries(
        Object.entries(current).filter(([k]) =>
          [
            'productNumber',
            'name',
            'description',
            'costPrice',
            'recommendedPrice',
            'salesPrice',
            'barCode',
            'barred',
            'productGroup',
            'unit',
            'departmentalDistribution',
          ].includes(k),
        ),
      );
      await this.client.rest('PUT', `/products/${encodeURIComponent(sku)}`, {
        body: { ...keep, ...patch },
      });
      return { action: 'update', destinationId: sku };
    }
    if (!isTrue(s['product.create'], true)) return { action: 'skip', destinationId: null };
    const row = (r.tables.productGroups ?? []).find((x) => x.from === p.category);
    const group = num(row?.group) ?? num(s['products.group']);
    if (!group)
      throw new WriteError('choose a product group for new products (products.group)', 'invalid');
    await this.client.rest('POST', '/products', {
      body: {
        productNumber: sku,
        name,
        productGroup: { productGroupNumber: group },
        salesPrice: kr(p.price),
        ...(p.ean ? { barCode: p.ean.slice(0, 50) } : {}),
        ...(num(s['lines.unit']) ? { unit: { unitNumber: num(s['lines.unit']) } } : {}),
      },
      idempotencyKey: this.idem('product', sku),
    });
    return { action: 'create', destinationId: sku };
  }

  /* -- Invoices (§4.6) -- */

  private async draftByExternalId(ext: string): Promise<Q2cDraft | null> {
    const [hit] = await this.client.apiList<Q2cDraft>(
      'q2c',
      '/invoices/drafts',
      { filter: `externalId$eq:${filterValue(ext)}` },
      1,
    );
    return hit ? this.getDraft(hit.number) : null;
  }

  private async getDraft(n: number): Promise<Q2cDraft | null> {
    try {
      return await this.client.api<Q2cDraft>('q2c', 'GET', `/invoices/drafts/${n}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  private async bookedByRef(ref: string, customer: number | null): Promise<EcoBooked | null> {
    const parts = [`references.other$eq:${filterValue(ref)}`];
    if (customer) parts.push(`customer.customerNumber$eq:${customer}`);
    const [hit] = await this.client.restList<EcoBooked>(
      '/invoices/booked',
      { filter: parts.join('$and:'), sort: '-bookedInvoiceNumber' },
      1,
    );
    return hit ?? null;
  }

  /**
   * The document an order already has (E8): the cross-reference, then the draft's externalId,
   * then a booked invoice with the same reference and customer (booked in e-conomic by hand).
   */
  private async findDocument(
    ext: string,
    ref: string,
    customer: number | null,
    existingId: string | null | undefined,
  ): Promise<Found | null> {
    const [kind, n] = (existingId ?? '').split(':');
    const known = num(n);
    if (kind === 'b' && known) {
      try {
        const booked = await this.client.rest<EcoBooked>('GET', `/invoices/booked/${known}`);
        return { kind: 'booked', number: known, booked };
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    if (kind === 'd' && known) {
      const draft = await this.getDraft(known);
      if (draft) return { kind: 'draft', number: known, draft };
    }
    const draft = await this.draftByExternalId(ext);
    if (draft) return { kind: 'draft', number: draft.number, draft };
    const booked = await this.bookedByRef(ref, customer);
    return booked ? { kind: 'booked', number: booked.bookedInvoiceNumber, booked } : null;
  }

  private async layout(s: Record<string, unknown>): Promise<number> {
    const set = num(s['invoice.layout']) ?? num(this.conn('layout'));
    if (set) return set;
    const [first] = await this.client.restList<{ layoutNumber: number; deleted?: boolean }>(
      '/layouts',
      {},
      20,
    );
    if (!first) throw new WriteError('the e-conomic agreement has no invoice layout', 'invalid');
    return first.layoutNumber;
  }

  /** Lines in the order's own order: its lines, then shipping (E5: every line has a product). */
  private async lines(
    src: {
      lines: OrderLine[];
      shipping?: number;
      shippingVatRate?: number;
      shippingMethod?: string | null;
    },
    r: RouteContext,
    lineFields: Record<string, string>[] | undefined,
    vatIncluded: boolean,
    sign: 1 | -1,
    dry: boolean,
  ): Promise<Q2cLine[]> {
    const unit = num(r.settings['lines.unit']);
    const price = (net: number, rate: number) => kr(vatIncluded ? net * (1 + rate) : net);
    const out: Q2cLine[] = [];
    for (const [i, l] of src.lines.entries()) {
      const productNumber = await this.productFor(l, r, dry);
      const qty = Math.abs(l.quantity);
      const gross = l.unitPrice * qty;
      const discount = gross > 0 && l.discount ? Math.round((l.discount / gross) * 10000) / 100 : 0;
      out.push({
        productNumber,
        description:
          (lineFields?.[i]?.['line.description'] || l.name).slice(0, 2500) || productNumber,
        quantity: sign * qty,
        unitNetPrice: price(l.unitPrice, l.vatRate),
        ...(discount ? { discountPercentage: Math.min(Math.max(discount, 0), 100) } : {}),
        ...(unit ? { unitNumber: unit } : {}),
      });
    }
    if ((src.shipping ?? 0) > 0) {
      const productNumber = r.mapping['products.shipping'];
      if (!productNumber)
        throw new WriteError(
          'choose the e-conomic product for shipping (Varer → Fragt)',
          'invalid',
        );
      out.push({
        productNumber,
        description: (src.shippingMethod || 'Fragt').slice(0, 2500),
        quantity: sign,
        unitNetPrice: price(src.shipping ?? 0, src.shippingVatRate ?? 0),
        ...(unit ? { unitNumber: unit } : {}),
      });
    }
    return out;
  }

  /** Writes the header, then replaces the lines (Q2C, E8). Returns the draft as e-conomic sees it. */
  private async saveDraft(
    header: Record<string, unknown>,
    existing: Q2cDraft | null,
    buildLines: (vatIncluded: boolean) => Promise<Q2cLine[]>,
    key: string,
  ): Promise<Q2cDraft> {
    let number: number;
    if (existing) {
      number = existing.number;
      const put = async (version: string | undefined) =>
        this.client.api('q2c', 'PUT', `/invoices/drafts/${number}`, {
          body: { ...header, number, objectVersion: version },
        });
      try {
        await put(existing.objectVersion);
      } catch (e) {
        // Someone changed the draft since we read it: read it again and retry once (E16).
        if (!(e instanceof HttpError && e.status === 409)) throw e;
        await put((await this.getDraft(number))?.objectVersion);
      }
      const old = await this.client.api<Q2cLine[]>(
        'q2c',
        'GET',
        `/invoices/drafts/${number}/lines`,
      );
      for (const l of old ?? [])
        if (l.number)
          await this.client.api('q2c', 'DELETE', `/invoices/drafts/${number}/lines/${l.number}`);
    } else {
      const created = await this.client.api<{ number: number }>('q2c', 'POST', '/invoices/drafts', {
        body: header,
        idempotencyKey: key,
      });
      number = created.number;
    }
    const draft = await this.getDraft(number);
    if (!draft) throw new WriteError(`the e-conomic draft ${number} disappeared`, 'transient');
    const lines = await buildLines(draft.isVatIncluded === true);
    for (let i = 0; i < lines.length; i += 100)
      await this.client.api('q2c', 'POST', `/invoices/drafts/${number}/lines/bulk`, {
        body: { lines: lines.slice(i, i + 100) },
      });
    return (await this.getDraft(number)) ?? draft;
  }

  /** e-conomic's total against the shop's, and the rounding policy (§4.3). */
  private async applyRounding(
    draft: Q2cDraft,
    shopTotal: number,
    r: RouteContext,
    warnings: Warning[],
  ) {
    const eco = ore((draft.amount ?? 0) + (draft.vatAmount ?? 0) + (draft.roundingAmount ?? 0));
    const diff = shopTotal - eco;
    if (Math.abs(diff) < 1) return;
    const policy = str(r.settings['rounding.policy'], 'line');
    const max = Math.round(Number(r.settings['rounding.maxDiff'] ?? 1) * 100);
    const params = {
      diff: String(kr(diff)),
      economic: String(kr(eco)),
      shop: String(kr(shopTotal)),
    };
    if (policy === 'fail' || Math.abs(diff) > max)
      throw new WriteError(
        `e-conomic's total ${params.economic} differs from the shop's ${params.shop} (draft ${draft.draftInvoiceNumber ?? draft.number} kept)`,
        'invalid',
      );
    if (policy === 'line') {
      const product = r.mapping['products.rounding'];
      if (!product)
        throw new WriteError(
          'choose the e-conomic product for rounding (Varer → Øreafrunding)',
          'invalid',
        );
      await this.client.api('q2c', 'POST', `/invoices/drafts/${draft.number}/lines/bulk`, {
        body: {
          lines: [
            {
              productNumber: product,
              description: 'Øreafrunding',
              quantity: 1,
              unitNetPrice: kr(diff),
            },
          ],
        },
      });
    }
    warnings.push({ code: 'TOTAL_ROUNDED', params });
  }

  private draftHeader(
    o: {
      customer: Customer;
      billing?: Order['billing'];
      shippingTo?: Order['shippingTo'];
      currency: string;
    },
    date: string,
    customerNumber: number,
    zone: number,
    layout: number,
    terms: number,
    fields: Record<string, string>,
    keys: { ext: string; ref: string; heading: string; text1: string; text2: string },
    s: Record<string, unknown>,
  ): Record<string, unknown> {
    const c = o.customer;
    const lang = this.conn('countryNames') === 'en' ? 'en' : 'da';
    const to = o.billing?.address ?? c.address;
    const ship = isTrue(s['invoice.delivery'], true) ? o.shippingTo : null;
    const name = o.billing?.company || o.billing?.name || c.companyName || c.name;
    return {
      customerNumber,
      customerName: name.slice(0, 255),
      date,
      currencyCode: o.currency || 'DKK',
      layoutNumber: layout,
      termOfPaymentNumber: terms,
      vatZoneNumber: zone,
      customerAddress: cut([to.line1, to.line2].filter(Boolean).join(', '), 255),
      customerPostalCode: cut(to.postalCode, 50),
      customerCity: cut(to.city, 250),
      customerCountry: to.country ? countryName(to.country, lang).slice(0, 50) : undefined,
      externalId: keys.ext,
      otherReference: keys.ref,
      heading: cut(fields[keys.heading], 250),
      textLine1: cut(fields[keys.text1], 1000),
      textLine2: cut(fields[keys.text2], 1000),
      ...(c.ean ? { debtorEan: c.ean.slice(0, 13), nemHandelReceiverType: 0 } : {}),
      ...(fields['invoice.publicEntryNumber']
        ? { publicEntryNumber: fields['invoice.publicEntryNumber'].slice(0, 30) }
        : {}),
      ...(c.kind === 'company' && (c.cvr || c.vatNumber)
        ? { cvr: (c.cvr || c.vatNumber)!.slice(0, 40) }
        : {}),
      ...(ship
        ? {
            deliveryAddress: cut(
              [ship.address.line1, ship.address.line2].filter(Boolean).join(', '),
              255,
            ),
            deliveryPostalCode: cut(ship.address.postalCode, 30),
            deliveryCity: cut(ship.address.city, 50),
            deliveryCountry: ship.address.country
              ? countryName(ship.address.country, lang).slice(0, 50)
              : undefined,
          }
        : {}),
    };
  }

  private customerRef(opts: WriteOptions, sourceId: string): number | null {
    return num(opts.refs?.[`customer:${sourceId}`]);
  }

  private async writeInvoice(o: Order, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const s = r.settings;
    const fields = opts.fields ?? {};
    const dry = opts.mode === 'dry_run';
    const warnings: Warning[] = [];
    const ext = (fields['invoice.externalId'] || `ag:o:${o.sourceId}`).slice(0, 50);
    const ref = (fields['invoice.otherReference'] ?? o.number).trim().slice(0, 250);
    if (!ref)
      throw new WriteError(
        'the invoice reference (invoice.otherReference) must not be empty',
        'invalid',
      );
    const customer = this.customerRef(opts, o.customer.sourceId);
    if (!customer && !dry) throw new WriteError('the order has no e-conomic customer', 'invalid');
    const zone = await this.zoneFor(o, r);
    const found = await this.findDocument(ext, ref, customer, opts.existingId);
    if (found?.kind === 'booked') {
      // A booked invoice is never changed (E7, D5): a different total needs a person.
      if (Math.abs(Math.abs(ore(found.booked.grossAmount ?? 0)) - o.total) >= 1)
        warnings.push({ code: 'CHANGED_AFTER_BOOKING', params: { order: o.number } });
      return {
        action: 'skip',
        destinationId: `b:${found.number}`,
        ...(warnings.length ? { warnings } : {}),
      };
    }
    if (dry) {
      // Product matching runs read-only, so a test run shows a missing product.
      await this.lines(o, r, opts.lineFields, false, 1, true);
      return { action: found ? 'update' : 'create', destinationId: null };
    }
    if (found && !isTrue(s['invoice.updateDrafts'], true))
      return { action: 'skip', destinationId: `d:${found.number}` };
    const paid = Boolean(o.paidAt);
    const terms =
      (paid ? num(s['paymentTerms.paid']) : null) ??
      num(s['paymentTerms.unpaid']) ??
      num((await this.getCustomer(customer!))?.paymentTerms?.paymentTermsNumber) ??
      (await this.defaultTerms(s));
    const when = str(s['invoice.date'], 'paid');
    const date = economicDate(
      when === 'today'
        ? new Date().toISOString()
        : when === 'order'
          ? o.createdAt
          : (o.paidAt ?? o.createdAt),
    );
    const header = this.draftHeader(
      o,
      date,
      customer!,
      zone,
      await this.layout(s),
      terms,
      fields,
      {
        ext,
        ref,
        heading: 'invoice.heading',
        text1: 'invoice.textLine1',
        text2: 'invoice.textLine2',
      },
      s,
    );
    const draft = await this.saveDraft(
      header,
      found?.kind === 'draft' ? found.draft : null,
      (vatIncluded) => this.lines(o, r, opts.lineFields, vatIncluded, 1, false),
      this.idem('draft', ext, hash(header)),
    );
    await this.applyRounding(draft, o.total, r, warnings);
    const action: WriteResult['action'] = found ? 'update' : 'create';
    const done = (id: string) => ({
      action,
      destinationId: id,
      ...(warnings.length ? { warnings } : {}),
    });
    if (opts.mode !== 'live' || !isTrue(s['invoice.bookAutomatically'], false))
      return done(`d:${draft.number}`);
    const booked = await this.book(draft, o, s);
    if (paid && isTrue(s['payment.register'], true)) {
      const w = await this.registerPayment(
        {
          currency: o.currency,
          amount: o.total,
          paidAt: o.paidAt!,
          method: o.paymentMethod?.id ?? '',
        },
        booked,
        customer!,
        r,
        fields['payment.text'] ||
          `${o.paymentMethod?.title ?? 'Betaling'} ${o.transactionId ?? ''}`.trim(),
        1,
      );
      if (w) warnings.push(w);
    }
    return done(`b:${booked}`);
  }

  /** Books a draft (REST only, E7) with the shop number and e-invoice when chosen. */
  private async book(
    draft: Q2cDraft,
    src: { number: string; customer: Customer },
    s: Record<string, unknown>,
  ): Promise<number> {
    const draftInvoiceNumber = draft.draftInvoiceNumber ?? draft.number;
    const ean =
      isTrue(s['send.eInvoice'], false) &&
      src.customer.ean &&
      this.ctx.credentials.canSendElectronicInvoice !== 'false';
    const sendBy = ean ? 'EAN' : isTrue(s['send.email'], false) ? 'Email' : undefined;
    const shopNumber =
      isTrue(s['invoice.bookWithShopNumber'], false) && /^\d{1,9}$/.test(src.number)
        ? Number(src.number)
        : undefined;
    const res = await this.client.rest<{ bookedInvoiceNumber: number }>(
      'POST',
      '/invoices/booked',
      {
        body: {
          draftInvoice: { draftInvoiceNumber },
          ...(shopNumber ? { bookWithNumber: shopNumber } : {}),
          ...(sendBy ? { sendBy } : {}),
        },
        idempotencyKey: this.idem('book', draftInvoiceNumber),
      },
    );
    return res.bookedInvoiceNumber;
  }

  /**
   * A customer payment in the journal against the booked invoice (E10). Only our own entry is
   * ever booked (`bookdraftentries`), never the whole journal. Returns a warning, never throws
   * for setup gaps: the invoice is booked already.
   */
  private async registerPayment(
    p: { currency: string; amount: number; paidAt: string; method: string },
    booked: number,
    customer: number,
    r: RouteContext,
    text: string,
    sign: 1 | -1,
  ): Promise<Warning | null> {
    const s = r.settings;
    const row = (r.tables.paymentMethods ?? []).find((x) => x.from === p.method);
    const journal = num(row?.journal) ?? num(s['payment.journal']);
    const contra = num(row?.account) ?? num(s['payment.account']);
    if (!journal || !contra)
      return { code: 'PAYMENT_NOT_REGISTERED', params: { method: p.method || '-' } };
    const entry = await this.client.api<{ entryNumber: number }>(
      'journals',
      'POST',
      '/draft-entries',
      {
        body: {
          entryTypeNumber: 2,
          journalNumber: journal,
          date: economicDate(p.paidAt),
          amount: PAYMENT_SIGN * sign * kr(p.amount),
          currency: p.currency || 'DKK',
          customerNumber: customer,
          customerInvoiceNumber: String(booked),
          contraAccountNumber: contra,
          text: text.slice(0, 250),
        },
        idempotencyKey: this.idem('payment', booked, sign),
      },
    );
    if (isTrue(s['payment.book'], false) && entry?.entryNumber)
      await this.client.api('journals', 'POST', `/journals/${journal}/bookdraftentries`, {
        body: { entryNumbers: [entry.entryNumber] },
      });
    return null;
  }

  /* -- Journal posting type (§4.3 posting.type journal) -- */

  private async vatOf(account: string): Promise<string | undefined> {
    if (!this.accountVat) {
      this.accountVat = new Map();
      for (const a of await this.accounts())
        if (a.vatAccount?.vatCode)
          this.accountVat.set(String(a.accountNumber), a.vatAccount.vatCode);
    }
    return this.accountVat.get(account);
  }

  private async writeJournal(o: Order, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const s = r.settings;
    const journal = num(s['journal.number']);
    if (!journal)
      throw new WriteError('choose the journal for vouchers (journal.number)', 'invalid');
    const row = (r.tables.paymentMethods ?? []).find((x) => x.from === (o.paymentMethod?.id ?? ''));
    const contra = num(row?.account) ?? num(s['payment.account']);
    if (!contra) throw new WriteError('choose the contra account (payment.account)', 'invalid');
    if (opts.existingId) return { action: 'skip', destinationId: opts.existingId };
    // Amounts incl. VAT per line on the engine's account (D3); shipping last.
    const parts = o.lines.map((l, i) => ({
      account: r.accounts[i] ?? null,
      gross: Math.round((l.unitPrice * Math.abs(l.quantity) - (l.discount ?? 0)) * (1 + l.vatRate)),
      text: opts.lineFields?.[i]?.['line.description'] || l.name,
    }));
    if (o.shipping > 0)
      parts.push({
        account: r.accounts[o.lines.length] ?? null,
        gross: Math.round(o.shipping * (1 + o.shippingVatRate)),
        text: o.shippingMethod || 'Fragt',
      });
    const missing = parts.find((p) => !num(p.account));
    if (missing) throw new WriteError(`no account for "${missing.text}"`, 'invalid');
    const diff = o.total - parts.reduce((a, p) => a + p.gross, 0);
    const warnings: Warning[] = [];
    if (Math.abs(diff) >= 1) {
      const max = Math.round(Number(s['rounding.maxDiff'] ?? 1) * 100);
      const account = r.mapping['accounts.rounding'];
      if (Math.abs(diff) > max || !account)
        throw new WriteError(`the lines differ from the order total by ${kr(diff)}`, 'invalid');
      parts.push({ account, gross: diff, text: 'Øreafrunding' });
      warnings.push({ code: 'TOTAL_ROUNDED', params: { diff: String(kr(diff)) } });
    }
    if (opts.mode === 'dry_run') return { action: 'create', destinationId: null };
    const date = economicDate(o.paidAt ?? o.createdAt);
    const text = (opts.fields?.['voucher.text'] || `Ordre ${o.number}`).slice(0, 250);
    const entries: number[] = [];
    let voucherNumber: number | undefined;
    for (const [i, p] of parts.entries()) {
      const vatCode = await this.vatOf(p.account!);
      const body = {
        entryTypeNumber: 5,
        journalNumber: journal,
        date,
        accountNumber: Number(p.account),
        ...(vatCode ? { vatCode } : {}),
        amount: VOUCHER_SIGN * kr(p.gross),
        currency: o.currency || 'DKK',
        contraAccountNumber: contra,
        text: `${text} ${p.text}`.slice(0, 250),
        ...(voucherNumber ? { voucherNumber } : {}),
      };
      const res = await this.client.api<{ entryNumber: number }>(
        'journals',
        'POST',
        '/draft-entries',
        {
          body,
          idempotencyKey: this.idem('voucher', o.sourceId, i, hash(body)),
        },
      );
      entries.push(res.entryNumber);
      // One voucher per order: the first entry gets its number from e-conomic, the rest reuse it.
      if (!voucherNumber)
        voucherNumber =
          (
            await this.client.api<{ voucherNumber?: number }>(
              'journals',
              'GET',
              `/draft-entries/${res.entryNumber}`,
            )
          )?.voucherNumber ?? undefined;
    }
    if (opts.mode === 'live' && isTrue(s['journal.book'], false))
      await this.client.api('journals', 'POST', `/journals/${journal}/bookdraftentries`, {
        body: { entryNumbers: entries },
      });
    return {
      action: 'create',
      destinationId: `j:${journal}:${voucherNumber ?? entries[0]}`,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /* -- Credit notes (E9) -- */

  private async writeCreditNote(cn: CreditNote, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const s = r.settings;
    const fields = opts.fields ?? {};
    const dry = opts.mode === 'dry_run';
    const orderNumber = cn.meta?.orderNumber ?? cn.orderSourceId;
    const ext = (fields['creditNote.externalId'] || `ag:r:${cn.sourceId}`).slice(0, 50);
    const ref = (fields['creditNote.otherReference'] ?? `${orderNumber}-R${cn.number}`)
      .trim()
      .slice(0, 250);
    if (!ref)
      throw new WriteError(
        'the credit note reference (creditNote.otherReference) must not be empty',
        'invalid',
      );
    const invoiceRef = (fields['creditNote.invoiceReference'] || orderNumber).slice(0, 250);
    const refCustomer = this.customerRef(opts, cn.customer.sourceId);
    const original = await this.bookedByRef(invoiceRef, refCustomer);
    if (!original && str(s['creditNote.missingInvoice'], 'wait') === 'wait')
      // The credit note waits until the invoice is booked, then it is retried (ED7).
      throw new WriteError(
        `the invoice for order ${orderNumber} is not booked in e-conomic yet`,
        'transient',
        3_600_000,
      );
    const customer = original?.customer?.customerNumber ?? refCustomer;
    if (!customer && !dry)
      throw new WriteError('the credit note has no e-conomic customer', 'invalid');
    const zone = original?.recipient?.vatZone?.vatZoneNumber ?? (await this.zoneFor(cn, r));
    const found = await this.findDocument(ext, ref, customer ?? null, opts.existingId);
    if (found?.kind === 'booked') return { action: 'skip', destinationId: `b:${found.number}` };
    if (dry) {
      await this.lines(cn, r, opts.lineFields, false, -1, true);
      return { action: found ? 'update' : 'create', destinationId: null };
    }
    if (found && !isTrue(s['invoice.updateDrafts'], true))
      return { action: 'skip', destinationId: `d:${found.number}` };
    const withInvoice = {
      ...fields,
      'creditNote.textLine1':
        fields['creditNote.textLine1'] ||
        (original ? `Kreditering af faktura ${original.bookedInvoiceNumber}` : ''),
    };
    const header = this.draftHeader(
      cn,
      economicDate(cn.createdAt),
      customer!,
      zone,
      await this.layout(s),
      num(s['paymentTerms.paid']) ?? (await this.defaultTerms(s)),
      withInvoice,
      {
        ext,
        ref,
        heading: 'creditNote.heading',
        text1: 'creditNote.textLine1',
        text2: 'creditNote.textLine2',
      },
      s,
    );
    const draft = await this.saveDraft(
      header,
      found?.kind === 'draft' ? found.draft : null,
      (vatIncluded) => this.lines(cn, r, opts.lineFields, vatIncluded, -1, false),
      this.idem('draft', ext, hash(header)),
    );
    const warnings: Warning[] = [];
    await this.applyRounding(draft, -cn.total, r, warnings);
    const action: WriteResult['action'] = found ? 'update' : 'create';
    if (opts.mode !== 'live' || !isTrue(s['creditNote.bookAutomatically'], false))
      return {
        action,
        destinationId: `d:${draft.number}`,
        ...(warnings.length ? { warnings } : {}),
      };
    const booked = await this.book(
      draft,
      { number: cn.number, customer: cn.customer },
      { ...s, 'invoice.bookWithShopNumber': false },
    );
    if (cn.refundsPayment && isTrue(s['creditNote.registerRefund'], false)) {
      const w = await this.registerPayment(
        {
          currency: cn.currency,
          amount: cn.total,
          paidAt: cn.createdAt,
          method: cn.meta?.paymentMethod ?? '',
        },
        booked,
        customer!,
        r,
        `Refusion ${cn.number}`,
        -1,
      );
      if (w) warnings.push(w);
    }
    return { action, destinationId: `b:${booked}`, ...(warnings.length ? { warnings } : {}) };
  }
}
