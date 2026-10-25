import { createHash } from 'node:crypto';
import {
  WriteError,
  type AdapterContext,
  type ConnectorAdapter,
  type FetchOptions,
  type LookupOption,
  type TestResult,
  type WebhookChange,
  type WriteOptions,
  type WriteResult,
} from '../adapter.js';
import type { LookupId } from '../manifest.js';
import type {
  CreditNote,
  Customer,
  Entity,
  EntityRecord,
  Order,
  OrderLine,
  Product,
} from '../model.js';
import { HttpError, retryAfter, safeTransport, toWriteError, type Transport } from './http.js';

/**
 * Dinero live client (PLAN-INTEGRATIONS-WOO-DINERO §5): public API at api.dinero.dk with Visma
 * Connect OAuth2. One grant covers every company the user can reach; the connection books in one
 * of them. VAT follows the account on each invoice line (F1). Dinero has no idempotency key, so
 * documents carry an external reference that is looked up before anything is created (F5).
 */

export const VISMA_CONNECT = 'https://connect.visma.com';
export const DINERO_API = 'https://api.dinero.dk';
export const DINERO_SCOPES = ['dineropublicapi:read', 'dineropublicapi:write', 'offline_access'];

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  /** Visma Connect base URL; tests point it elsewhere. */
  connectUrl?: string;
}

export function dineroAuthorizeUrl(c: {
  clientId: string;
  redirectUri: string;
  state: string;
  connectUrl?: string;
}) {
  const u = new URL('/connect/authorize', c.connectUrl ?? VISMA_CONNECT);
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', DINERO_SCOPES.join(' '));
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('state', c.state);
  u.searchParams.set('ui_locales', 'da-DK');
  return u.toString();
}

export interface DineroTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** Token request at Visma Connect: form-encoded, never JSON (Dinero's docs say JSON fails). */
export async function vismaToken(
  client: OAuthClient,
  grant:
    | { grant_type: 'authorization_code'; code: string; redirect_uri: string }
    | { grant_type: 'refresh_token'; refresh_token: string },
  transport: Transport = safeTransport,
  now = Date.now(),
): Promise<DineroTokens> {
  const body = new URLSearchParams({
    ...grant,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  const res = await transport(
    new URL('/connect/token', client.connectUrl ?? VISMA_CONNECT).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    },
  );
  if (res.status >= 400) {
    // invalid_grant: the refresh token was revoked, expired or replayed; the user must log in again.
    throw new WriteError(
      `Visma Connect refused the token request (${res.status})`,
      res.status >= 500 ? 'transient' : 'unauthorized',
    );
  }
  const t = JSON.parse(res.body) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!t.access_token)
    throw new WriteError('Visma Connect returned no access token', 'unauthorized');
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? ('refresh_token' in grant ? grant.refresh_token : ''),
    expiresAt: new Date(now + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
}

/** RFC 4122 v5 UUID: the same order always gets the same Dinero Guid (F5). */
export function uuidV5(name: string, namespace = '6f1c3c4e-6b44-5a8e-9b1a-4b0f3d1e2a77'): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/* ---- Client ------------------------------------------------------------------------------------ */

export class DineroClient {
  constructor(
    private readonly ctx: AdapterContext & {
      oauth?: OAuthClient;
      transport?: Transport;
      now?: () => number;
    },
  ) {}

  private get transport() {
    return this.ctx.transport ?? safeTransport;
  }
  private now() {
    return this.ctx.now?.() ?? Date.now();
  }

  /** A valid access token, refreshed a minute before it lapses; the new tokens go to the key box. */
  private async token(force = false): Promise<string> {
    const c = this.ctx.credentials;
    const expires = c.expiresAt ? Date.parse(c.expiresAt) : 0;
    if (!force && c.accessToken && expires - 60_000 > this.now()) return c.accessToken;
    if (!c.refreshToken || !this.ctx.oauth)
      throw new WriteError('Dinero access has expired; log in again', 'unauthorized');
    const t = await vismaToken(
      this.ctx.oauth,
      { grant_type: 'refresh_token', refresh_token: c.refreshToken },
      this.transport,
      this.now(),
    );
    Object.assign(c, t);
    await this.ctx.persist?.({ ...t });
    return t.accessToken;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, DINERO_API);
    for (const [k, v] of Object.entries(opts.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const send = async (force: boolean) =>
      this.transport(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${await this.token(force)}`,
          accept: 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    let res = await send(false);
    if (res.status === 401 && this.ctx.credentials.refreshToken) res = await send(true);
    if (res.status >= 400)
      // Dinero sends no Retry-After on 429; it asks for a pause of about a minute (F4).
      throw new HttpError(
        res.status,
        res.body.slice(0, 500),
        res.status === 429 ? retryAfter(res.headers, 60_000) : null,
      );
    return (res.body ? JSON.parse(res.body) : null) as T;
  }
}

/** Dinero's error code in a 400 body, e.g. 58 (stale Timestamp) or 90 (no Pro licence). */
export function dineroCode(e: unknown): number | null {
  if (!(e instanceof HttpError)) return null;
  const m = /"code"\s*:\s*(\d+)/i.exec(e.body);
  return m ? Number(m[1]) : null;
}

function dineroWriteError(e: unknown): WriteError {
  if (e instanceof HttpError) {
    // 480 Brownout: a deprecated endpoint. Not the customer's data; retried, and seen in logs.
    if (e.status === 480) return new WriteError(`Dinero brownout: ${e.message}`, 'transient');
    if (dineroCode(e) === 90)
      return new WriteError('The Dinero company has no Pro or Total licence', 'unauthorized');
  }
  return toWriteError(e);
}

/* ---- Mapping to Dinero ------------------------------------------------------------------------- */

const kr = (ore: number) => Math.round(ore) / 100;

/** A date as Dinero wants it (YYYY-MM-DD), in Danish time. */
export function dineroDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(
    Number.isNaN(d.getTime()) ? new Date() : d,
  );
}

interface RouteContext {
  settings: Record<string, unknown>;
  mapping: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
  /** Accounts the engine chose for each order line, then shipping (planInvoice). */
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

const isTrue = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);

function language(r: RouteContext, country: string): 'da-DK' | 'en-GB' {
  const v = str(r.settings['invoice.language'], 'da');
  if (v === 'en') return 'en-GB';
  if (v === 'byCountry') return country.toUpperCase() === 'DK' ? 'da-DK' : 'en-GB';
  return 'da-DK';
}

interface DineroLine {
  ProductGuid?: string | null;
  Description: string;
  Comments?: string | null;
  Quantity: number;
  AccountNumber: number;
  Unit: string;
  Discount: number;
  LineType: 'Product' | 'Text';
  BaseAmountValue: number;
}

function productLine(l: OrderLine, account: string | null, description: string): DineroLine {
  if (!account || !/^\d{1,8}$/.test(account))
    throw new WriteError(`no Dinero account for the line "${l.name}"`, 'invalid');
  const gross = l.unitPrice * Math.abs(l.quantity);
  const discount = gross > 0 && l.discount ? Math.round((l.discount / gross) * 100 * 100) / 100 : 0;
  return {
    Description: description.slice(0, 1000) || l.name,
    Quantity: Math.abs(l.quantity),
    AccountNumber: Number(account),
    Unit: 'parts',
    Discount: Math.min(Math.max(discount, 0), 100),
    LineType: 'Product',
    BaseAmountValue: kr(l.unitPrice),
  };
}

/** Invoice lines in the engine's account order: the order's lines, then shipping. */
export function invoiceLines(
  o: Order,
  r: RouteContext,
  lineFields: Record<string, string>[] = [],
): DineroLine[] {
  const lines = o.lines.map((l, i) =>
    productLine(l, r.accounts[i] ?? null, lineFields[i]?.['line.description'] ?? l.name),
  );
  if (o.shipping > 0) {
    const account = r.accounts[o.lines.length] ?? null;
    lines.push(
      productLine(
        {
          sku: null,
          productId: null,
          name: o.shippingMethod || 'Fragt',
          quantity: 1,
          unitPrice: o.shipping,
          vatRate: o.shippingVatRate,
          category: null,
        },
        account,
        o.shippingMethod || 'Fragt',
      ),
    );
  }
  return lines;
}

interface InvoiceRead {
  Guid: string;
  Status?: string;
  Number?: number | null;
  TimeStamp?: string;
  Timestamp?: string;
  TotalInclVat?: number;
  TotalInclVatInDkk?: number;
  ProductLines?: { AccountNumber: number; Description?: string }[];
}

const stamp = (r: { TimeStamp?: string; Timestamp?: string } | null | undefined) =>
  r?.TimeStamp ?? r?.Timestamp ?? '';
const isDraft = (r: InvoiceRead) => !r.Status || r.Status === 'Draft';

/* ---- Adapter ----------------------------------------------------------------------------------- */

export interface DineroContext extends AdapterContext {
  oauth?: OAuthClient;
  transport?: Transport;
  now?: () => number;
}

interface Organization {
  Id: number;
  Name: string;
  IsVatFree?: boolean;
  Subscription?: { HasPro?: boolean; HasPayingPro?: boolean; HasTotal?: boolean };
}

const licensed = (o: Organization) =>
  !o.Subscription ||
  Boolean(o.Subscription.HasPro || o.Subscription.HasPayingPro || o.Subscription.HasTotal);

export class DineroAdapter implements ConnectorAdapter {
  readonly connectorId = 'dinero';
  private readonly client: DineroClient;

  constructor(private readonly ctx: DineroContext) {
    if (!ctx.credentials.accessToken && !ctx.credentials.refreshToken)
      throw new WriteError('Dinero credentials are incomplete', 'unauthorized');
    this.client = new DineroClient(ctx);
  }

  /** The company the connection books in: the setting, else the one found at the first test. */
  private org(): string {
    const id = String(
      this.ctx.settings?.organizationId ?? this.ctx.credentials.organizationId ?? '',
    );
    if (!/^\d{1,12}$/.test(id))
      throw new WriteError('no Dinero company chosen for the connection', 'invalid');
    return id;
  }

  async test(): Promise<TestResult> {
    try {
      const orgs = await this.client.request<Organization[]>('GET', '/v1.1/organizations', {
        query: { fields: 'Id,Name,IsVatFree,Subscription' },
      });
      const chosen = String(
        this.ctx.settings?.organizationId ?? this.ctx.credentials.organizationId ?? '',
      );
      let org = orgs.find((o) => String(o.Id) === chosen);
      if (chosen && !org)
        return {
          ok: false,
          reason: 'unauthorized',
          message: 'Brugeren har ikke længere adgang til virksomheden i Dinero.',
        };
      if (!org) {
        org = orgs.find(licensed) ?? orgs[0];
        if (!org)
          return {
            ok: false,
            reason: 'unknown',
            message: 'Brugeren har ingen virksomheder i Dinero.',
          };
        await this.ctx.persist?.({ organizationId: String(org.Id) });
        this.ctx.credentials.organizationId = String(org.Id);
      }
      // Without Pro or Total every call but /organizations fails with error 90.
      if (!licensed(org))
        return {
          ok: false,
          reason: 'unauthorized',
          message: `${org.Name} har ikke Dinero Pro eller Total, som API'et kræver.`,
        };
      return { ok: true, account: { id: String(org.Id), name: org.Name } };
    } catch (e) {
      const w = dineroWriteError(e);
      if (w.kind === 'unauthorized')
        return {
          ok: false,
          reason: 'unauthorized',
          message: 'Dinero afviste adgangen. Log ind igen.',
        };
      if (w.kind === 'transient' || w.kind === 'rate_limited')
        return { ok: false, reason: 'unreachable', message: 'Dinero svarede ikke.' };
      return { ok: false, reason: 'unknown', message: w.message.slice(0, 200) };
    }
  }

  async lookup(list: LookupId): Promise<LookupOption[]> {
    if (list === 'organizations') {
      const orgs = await this.client.request<Organization[]>('GET', '/v1.1/organizations', {
        query: { fields: 'Id,Name,Subscription' },
      });
      return orgs.map((o) => ({
        value: String(o.Id),
        label: licensed(o) ? o.Name : `${o.Name} (kræver Pro)`,
      }));
    }
    const org = this.org();
    if (list === 'accounts') {
      const rows = await this.client.request<
        { AccountNumber: number; Name: string; VatCode?: string | null; IsHidden?: boolean }[]
      >('GET', `/v1/${org}/accounts/entry`, {
        query: { fields: 'AccountNumber,Name,VatCode,IsHidden' },
      });
      return rows
        .filter((a) => !a.IsHidden)
        .map((a) => ({
          value: String(a.AccountNumber),
          label: a.Name,
          ...(a.VatCode ? { vatCode: a.VatCode } : {}),
        }));
    }
    if (list === 'depositAccounts') {
      const rows = await this.client.request<
        { AccountNumber?: number; Number?: number; Name: string }[]
      >('GET', `/v1/${org}/accounts/deposit`, {
        query: { fields: 'AccountNumber,Name' },
      });
      return rows.map((a) => ({ value: String(a.AccountNumber ?? a.Number), label: a.Name }));
    }
    if (list === 'vatCodes') {
      const rows = await this.client.request<{ VatCode: string; Name: string; VatRate?: number }[]>(
        'GET',
        `/v1/${org}/vatTypes`,
      );
      return rows.map((v) => ({ value: v.VatCode, label: `${v.VatCode} · ${v.Name}` }));
    }
    if (list === 'templates' || list === 'invoiceTemplates') {
      const rows = await this.client.request<{ Id?: string; TemplateId?: string; Name: string }[]>(
        'GET',
        `/v1/${org}/invoices/templates`,
      );
      return rows.map((t) => ({ value: String(t.Id ?? t.TemplateId), label: t.Name }));
    }
    return [];
  }

  async fetch<E extends Entity>(entity: E, opts: FetchOptions): Promise<EntityRecord[E][]> {
    if (entity !== 'customer') return [];
    const org = this.org();
    const out: Customer[] = [];
    for (let page = 0; out.length < opts.limit; page++) {
      const res = await this.client.request<{
        Collection: DineroContact[];
        Pagination?: { Result: number };
      }>('GET', `/v2/${org}/contacts`, {
        query: {
          fields: CONTACT_FIELDS,
          pageSize: Math.min(1000, opts.limit),
          page,
          deletedOnly: 'false',
          ...(opts.since ? { changesSince: opts.since.replace(/\.\d{3}Z$/, 'Z') } : {}),
        },
      });
      out.push(...res.Collection.map(contactToCustomer));
      if (res.Collection.length < Math.min(1000, opts.limit)) break;
    }
    return out.slice(0, opts.limit) as EntityRecord[E][];
  }

  async get<E extends Entity>(entity: E, sourceId: string): Promise<EntityRecord[E] | null> {
    if (entity !== 'customer' || !/^[0-9a-f-]{36}$/i.test(sourceId)) return null;
    try {
      const c = await this.client.request<DineroContact>(
        'GET',
        `/v1/${this.org()}/contacts/${sourceId}`,
      );
      return contactToCustomer(c) as EntityRecord[E];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  parseWebhook(): WebhookChange | null {
    return null;
  }

  async write<E extends Entity>(
    entity: E,
    record: EntityRecord[E],
    opts: WriteOptions,
  ): Promise<WriteResult> {
    try {
      if (entity === 'customer') return await this.writeContact(record as Customer, opts);
      if (entity === 'order') return await this.writeInvoice(record as Order, opts);
      if (entity === 'creditNote') return await this.writeCreditNote(record as CreditNote, opts);
      if (entity === 'product') return await this.writeProduct(record as Product, opts);
      throw new WriteError(`Dinero does not receive ${entity}`, 'invalid');
    } catch (e) {
      throw dineroWriteError(e);
    }
  }

  /* -- Contacts -- */

  private async findOne<T>(path: string, filter: string, fields: string): Promise<T | null> {
    const res = await this.client.request<{ Collection: T[] }>('GET', path, {
      query: { queryFilter: filter, fields, pageSize: 2 },
    });
    return res.Collection?.[0] ?? null;
  }

  private async writeContact(c: Customer, opts: WriteOptions): Promise<WriteResult> {
    const org = this.org();
    const r = routeOf(opts);
    const ext = (opts.fields?.['contact.externalReference'] ?? `agentor:${c.sourceId}`).slice(
      0,
      128,
    );
    const match = str(r.settings['contact.match'], 'email');
    const body = contactBody(c, ext, r);
    let guid = opts.existingId ?? null;
    if (!guid)
      guid =
        (
          await this.findOne<{ ContactGuid: string }>(
            `/v1/${org}/contacts`,
            `ExternalReference eq '${q(ext)}'`,
            'ContactGuid',
          )
        )?.ContactGuid ?? null;
    if (!guid && match === 'email' && c.email)
      guid =
        (
          await this.findOne<{ ContactGuid: string }>(
            `/v1/${org}/contacts`,
            `Email eq '${q(c.email)}'`,
            'ContactGuid',
          )
        )?.ContactGuid ?? null;
    if (!guid && match === 'vatNumber' && c.vatNumber)
      guid =
        (
          await this.findOne<{ ContactGuid: string }>(
            `/v1/${org}/contacts`,
            `VatNumber eq '${q(c.vatNumber)}'`,
            'ContactGuid',
          )
        )?.ContactGuid ?? null;
    if (opts.mode === 'dry_run') return { action: guid ? 'update' : 'create', destinationId: null };
    if (guid) {
      if (!isTrue(r.settings['contact.update'], true))
        return { action: 'skip', destinationId: guid };
      // PUT v2 replaces the whole contact: read it, keep what we don't own, write it back.
      const current = await this.client.request<Record<string, unknown>>(
        'GET',
        `/v1/${org}/contacts/${guid}`,
      );
      await this.client.request('PUT', `/v2/${org}/contacts/${guid}`, {
        body: {
          ...pickContact(current),
          ...body,
          ExternalReference: current.ExternalReference ?? ext,
        },
      });
      return { action: 'update', destinationId: guid };
    }
    const created = await this.client.request<{ ContactGuid: string }>(
      'POST',
      `/v1/${org}/contacts`,
      {
        body: { ...body, ContactGuid: uuidV5(`contact:${org}:${ext}`) },
      },
    );
    return {
      action: 'create',
      destinationId: created?.ContactGuid ?? uuidV5(`contact:${org}:${ext}`),
    };
  }

  /* -- Products -- */

  private async writeProduct(p: Product, opts: WriteOptions): Promise<WriteResult> {
    const org = this.org();
    const r = routeOf(opts);
    const account =
      p.vatRate === 0 ? r.mapping['accounts.vatFree'] : r.mapping['accounts.domestic'];
    if (!account) throw new WriteError('no Dinero account for products', 'invalid');
    const ext = (opts.fields?.['product.externalReference'] ?? `agentor:${p.sourceId}`).slice(
      0,
      128,
    );
    const body = {
      ProductNumber: p.sku ?? undefined,
      Name: p.name.slice(0, 200),
      BaseAmountValue: kr(p.price),
      Quantity: 1,
      AccountNumber: Number(account),
      Unit: str(r.settings['product.unit'], 'parts'),
      ExternalReference: ext,
    };
    let guid =
      opts.existingId ??
      (
        await this.findOne<{ ProductGuid: string }>(
          `/v1/${org}/products`,
          `ExternalReference eq '${q(ext)}'`,
          'ProductGuid',
        )
      )?.ProductGuid ??
      null;
    if (!guid && p.sku)
      guid =
        (
          await this.findOne<{ ProductGuid: string }>(
            `/v1/${org}/products`,
            `ProductNumber eq '${q(p.sku)}'`,
            'ProductGuid',
          )
        )?.ProductGuid ?? null;
    if (opts.mode === 'dry_run') return { action: guid ? 'update' : 'create', destinationId: null };
    if (guid) {
      await this.client.request('PUT', `/v1/${org}/products/${guid}`, { body });
      return { action: 'update', destinationId: guid };
    }
    const created = await this.client.request<{ ProductGuid: string }>(
      'POST',
      `/v1/${org}/products`,
      { body },
    );
    return { action: 'create', destinationId: created.ProductGuid };
  }

  /* -- Invoices -- */

  private async invoiceByRef(
    org: string,
    ext: string,
    existingId: string | null,
  ): Promise<InvoiceRead | null> {
    if (existingId) {
      try {
        return await this.client.request<InvoiceRead>('GET', `/v1/${org}/invoices/${existingId}`);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    const hit = await this.findOne<InvoiceRead>(
      `/v1/${org}/invoices`,
      `ExternalReference eq '${q(ext)}'`,
      'Guid,Status,Number',
    );
    return hit ? this.client.request<InvoiceRead>('GET', `/v1/${org}/invoices/${hit.Guid}`) : null;
  }

  private async writeInvoice(o: Order, opts: WriteOptions): Promise<WriteResult> {
    const org = this.org();
    const r = routeOf(opts);
    const ext = (opts.fields?.['invoice.externalReference'] ?? `agentor:${o.sourceId}`).slice(
      0,
      128,
    );
    const contactGuid = opts.refs?.[`customer:${o.customer.sourceId}`] ?? null;
    const paid = Boolean(o.paidAt) || o.status === 'completed';
    const date =
      str(r.settings['invoice.date'], 'order') === 'today'
        ? dineroDate(new Date().toISOString())
        : dineroDate(o.paidAt ?? o.createdAt);
    const lines = invoiceLines(o, r, opts.lineFields);
    if (lines.length === 0) throw new WriteError('the order has no lines', 'invalid');
    const days = Number(r.settings['contact.paymentDays'] ?? 8);
    const body: Record<string, unknown> = {
      ContactGuid: contactGuid,
      Date: date,
      Currency: o.currency || 'DKK',
      Language: language(r, o.customer.address.country),
      ExternalReference: ext,
      Description: opts.fields?.['invoice.description'] ?? `Ordre ${o.number}`,
      Comment: opts.fields?.['invoice.comment'] || null,
      ShowLinesInclVat: false,
      PaymentConditionType: paid ? 'Paid' : 'Netto',
      PaymentConditionNumberOfDays: paid ? null : Number.isFinite(days) ? days : 8,
      ...(str(r.settings['invoice.template'], '')
        ? { InvoiceTemplateId: r.settings['invoice.template'] }
        : {}),
      ProductLines: lines,
    };
    // Rounding (PLAN §5.3): Dinero computes the total itself; compare it with the shop's.
    const preview = await this.client.request<InvoiceRead>('POST', `/v1/${org}/invoices/fetch`, {
      body,
    });
    const diff = Math.round(o.total - Math.round((preview?.TotalInclVat ?? kr(o.total)) * 100));
    if (Math.abs(diff) >= 1) {
      const max = Math.round(Number(r.settings['rounding.maxDiff'] ?? 1) * 100);
      const account = r.mapping['accounts.rounding'];
      if (Math.abs(diff) > max)
        throw new WriteError(
          `Dinero's total differs from the order by ${kr(diff)} ${o.currency}`,
          'invalid',
        );
      if (account)
        lines.push({
          Description: 'Øreafrunding',
          Quantity: 1,
          AccountNumber: Number(account),
          Unit: 'parts',
          Discount: 0,
          LineType: 'Product',
          BaseAmountValue: kr(diff),
        });
    }
    const existing = await this.invoiceByRef(org, ext, opts.existingId ?? null);
    if (opts.mode === 'dry_run')
      return { action: existing ? 'update' : 'create', destinationId: null };
    if (existing && !isDraft(existing)) return { action: 'skip', destinationId: existing.Guid }; // never amend a booked invoice (D5)
    let guid: string;
    let ts: string;
    let action: WriteResult['action'];
    if (existing) {
      if (!isTrue(r.settings['invoice.updateDrafts'], true))
        return { action: 'skip', destinationId: existing.Guid };
      const res = await this.withFreshStamp(
        () => stamp(existing),
        () =>
          this.client
            .request<InvoiceRead>('GET', `/v1/${org}/invoices/${existing.Guid}`)
            .then(stamp),
        (t) =>
          this.client.request<{ TimeStamp?: string }>(
            'PUT',
            `/v1.2/${org}/invoices/${existing.Guid}`,
            { body: { ...body, Timestamp: t } },
          ),
      );
      guid = existing.Guid;
      ts =
        stamp(res) ||
        stamp(await this.client.request<InvoiceRead>('GET', `/v1/${org}/invoices/${guid}`));
      action = 'update';
    } else {
      const created = await this.client.request<{ Guid: string; TimeStamp?: string }>(
        'POST',
        `/v1/${org}/invoices`,
        {
          body: { ...body, Guid: uuidV5(`invoice:${org}:${ext}`) },
        },
      );
      guid = created.Guid;
      ts = stamp(created);
      action = 'create';
    }
    if (opts.mode !== 'live') return { action, destinationId: guid };
    if (!contactGuid) throw new WriteError('a booked invoice needs a Dinero contact', 'invalid');
    const booked = await this.withFreshStamp(
      () => ts,
      () => this.client.request<InvoiceRead>('GET', `/v1/${org}/invoices/${guid}`).then(stamp),
      (t) =>
        this.client.request<InvoiceRead>('POST', `/v1/${org}/invoices/${guid}/book`, {
          body: { Timestamp: t },
        }),
    );
    await this.afterBooking(org, guid, booked, o, r, opts);
    return { action, destinationId: guid };
  }

  /** Payment, e-mail and e-invoice after booking (PLAN §5.3, D6). */
  private async afterBooking(
    org: string,
    guid: string,
    booked: InvoiceRead,
    o: Order,
    r: RouteContext,
    opts: WriteOptions,
  ) {
    let ts = stamp(booked);
    const paidAt = o.paidAt;
    if (paidAt && isTrue(r.settings['payment.register'], true)) {
      const method = o.paymentMethod?.id ?? '';
      const row = (r.tables.paymentMethods ?? []).find((x) => x.from === method);
      const account =
        row?.account ||
        str(r.settings['payment.account'], '') ||
        str(this.ctx.settings?.clearingAccount, '');
      if (account && /^\d{1,8}$/.test(account)) {
        const foreign = (o.currency || 'DKK') !== 'DKK';
        const amountDkk = foreign ? (booked.TotalInclVatInDkk ?? 0) : kr(o.total);
        if (!foreign || amountDkk > 0) {
          const res = await this.client.request<{ TimeStamp?: string }>(
            'POST',
            `/v1/${org}/invoices/${guid}/payments`,
            {
              body: {
                Timestamp: ts,
                DepositAccountNumber: Number(account),
                Amount: amountDkk,
                ...(foreign ? { AmountInForeignCurrency: kr(o.total) } : {}),
                RemainderIsFee: isTrue(r.settings['payment.remainderIsFee'], false),
                ExternalReference: (o.transactionId ?? '').slice(0, 128) || null,
                PaymentDate: dineroDate(paidAt),
                Description: (
                  opts.fields?.['payment.description'] ??
                  o.paymentMethod?.title ??
                  'Betaling'
                ).slice(0, 250),
              },
            },
          );
          ts = stamp(res) || ts;
        }
      }
    }
    if (isTrue(r.settings['send.eInvoice'], false) && o.customer.ean) {
      await this.client.request('POST', `/v3/${org}/invoices/${guid}/e-invoice`, {
        body: {
          Timestamp: ts,
          OrderReference: o.number,
          AttPerson: o.billing?.name ?? null,
          PaymentMeanEnum: 'Domestic',
        },
      });
    } else if (isTrue(r.settings['send.email'], false) && o.customer.email) {
      await this.client.request('POST', `/v1/${org}/invoices/${guid}/email`, {
        body: {
          Timestamp: ts,
          Receiver: o.customer.email,
          AddVoucherAsPdfAttachment: true,
          ShouldAddTrustPilotEmailAsBcc: false,
          Message:
            opts.fields?.['email.message'] ??
            `Tak for din ordre ${o.number}. Fakturaen kan ses her: [link-to-pdf]`,
        },
      });
    }
  }

  /**
   * Runs a write that needs the newest Timestamp, re-reading it once when Dinero says it is stale
   * (error 58, F6).
   */
  private async withFreshStamp<T>(
    current: () => string,
    reread: () => Promise<string>,
    run: (t: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(current());
    } catch (e) {
      if (dineroCode(e) !== 58) throw e;
      return run(await reread());
    }
  }

  /* -- Credit notes -- */

  private async writeCreditNote(cn: CreditNote, opts: WriteOptions): Promise<WriteResult> {
    const org = this.org();
    const r = routeOf(opts);
    const ext = (opts.fields?.['creditNote.externalReference'] ?? `agentor:${cn.sourceId}`).slice(
      0,
      128,
    );
    const invoiceRef =
      opts.fields?.['creditNote.invoiceReference'] ?? `agentor:${cn.orderSourceId}`;
    const invoice = await this.invoiceByRef(org, invoiceRef, null);
    if (!invoice)
      throw new WriteError(
        `the invoice for order ${cn.meta?.orderNumber ?? cn.orderSourceId} is not in Dinero`,
        'invalid',
      );
    if (isDraft(invoice))
      throw new WriteError('the invoice is still a draft in Dinero; book it first', 'invalid');
    // Credit notes reuse the original invoice's accounts (manifest note): line by line, else the first.
    const accounts = (invoice.ProductLines ?? []).map((l) => String(l.AccountNumber));
    const pick = (i: number, name: string) =>
      (invoice.ProductLines ?? []).find((l) => l.Description === name)?.AccountNumber?.toString() ??
      accounts[i] ??
      accounts[0] ??
      null;
    const lines = cn.lines.map((l, i) =>
      productLine(l, pick(i, l.name), opts.lineFields?.[i]?.['line.description'] ?? l.name),
    );
    const body = {
      ContactGuid: opts.refs?.[`customer:${cn.customer.sourceId}`] ?? null,
      CreditNoteFor: invoice.Guid,
      Date: dineroDate(cn.createdAt),
      Currency: cn.currency || 'DKK',
      Language: language(r, cn.customer.address.country),
      ExternalReference: ext,
      Description: opts.fields?.['creditNote.description'] ?? `Kreditnota ${cn.number}`,
      ShowLinesInclVat: false,
      ProductLines: lines,
    };
    const existing = await this.findOne<InvoiceRead>(
      `/v1/${org}/sales/creditnotes`,
      `ExternalReference eq '${q(ext)}'`,
      'Guid,Status',
    );
    if (opts.mode === 'dry_run')
      return { action: existing ? 'update' : 'create', destinationId: null };
    if (existing) return { action: 'skip', destinationId: existing.Guid };
    const created = await this.client.request<{ Guid: string; TimeStamp?: string }>(
      'POST',
      `/v1/${org}/sales/creditnotes`,
      {
        body: { ...body, Guid: uuidV5(`creditnote:${org}:${ext}`) },
      },
    );
    if (opts.mode === 'live')
      await this.withFreshStamp(
        () => stamp(created),
        () =>
          this.client
            .request<InvoiceRead>('GET', `/v1/${org}/sales/creditnotes/${created.Guid}`)
            .then(stamp),
        (t) =>
          this.client.request('POST', `/v1/${org}/sales/creditnotes/${created.Guid}/book`, {
            body: { Timestamp: t },
          }),
      );
    return { action: 'create', destinationId: created.Guid };
  }
}

/* ---- Contacts ---------------------------------------------------------------------------------- */

interface DineroContact {
  ContactGuid: string;
  Name: string;
  Email?: string | null;
  Phone?: string | null;
  Street?: string | null;
  ZipCode?: string | null;
  City?: string | null;
  CountryKey?: string | null;
  VatNumber?: string | null;
  EanNumber?: string | null;
  IsPerson?: boolean;
}

const CONTACT_FIELDS =
  'ContactGuid,Name,Email,Phone,Street,ZipCode,City,CountryKey,VatNumber,EanNumber,IsPerson';

function contactToCustomer(c: DineroContact): Customer {
  return {
    sourceId: c.ContactGuid,
    kind: c.IsPerson ? 'person' : 'company',
    name: c.Name,
    email: c.Email ?? null,
    phone: c.Phone ?? null,
    vatNumber: c.VatNumber ?? null,
    address: {
      line1: c.Street ?? null,
      postalCode: c.ZipCode ?? null,
      city: c.City ?? null,
      country: (c.CountryKey ?? 'DK').toUpperCase(),
    },
    ean: c.EanNumber ?? null,
  };
}

/** Single quotes in Dinero's queryFilter values. */
const q = (v: string) => v.replace(/'/g, "''").slice(0, 200);

function contactBody(c: Customer, ext: string, r: RouteContext): Record<string, unknown> {
  const company = c.kind === 'company';
  const days = Number(r.settings['contact.paymentDays'] ?? 8);
  return {
    ExternalReference: ext,
    Name: c.name.slice(0, 200),
    Street: [c.address.line1, c.address.line2].filter(Boolean).join(', ') || null,
    ZipCode: c.address.postalCode,
    City: c.address.city,
    CountryKey: c.address.country || 'DK',
    Phone: c.phone,
    Email: c.email,
    VatNumber: company ? (c.vatNumber ?? c.cvr ?? null) : null,
    EanNumber: company ? (c.ean ?? null) : null,
    AttPerson: null,
    IsPerson: !company,
    IsMember: false,
    UseCvr: false,
    PaymentConditionType: 'Netto',
    PaymentConditionNumberOfDays: Number.isFinite(days) ? days : 8,
  };
}

/** The fields of a Dinero contact a PUT keeps when we don't set them. */
function pickContact(c: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    'Name',
    'Street',
    'ZipCode',
    'City',
    'CountryKey',
    'Phone',
    'Email',
    'Webpage',
    'AttPerson',
    'VatNumber',
    'EanNumber',
    'SENumber',
    'PNumber',
    'PaymentConditionType',
    'PaymentConditionNumberOfDays',
    'IsPerson',
    'IsMember',
    'MemberNumber',
    'UseCvr',
    'CompanyTypeKey',
    'InvoiceMailOutOptionKey',
    'PreferredInvoiceLanguageKey',
    'PreferredInvoiceCurrencyKey',
  ];
  return Object.fromEntries(keep.filter((k) => k in c).map((k) => [k, c[k]]));
}
