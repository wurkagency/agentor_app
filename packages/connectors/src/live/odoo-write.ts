import { WriteError, type WriteOptions, type WriteResult } from '../adapter.js';
import {
  saleKind,
  type CreditNote,
  type Customer,
  type Order,
  type OrderLine,
  type Product,
  type SaleKind,
} from '../model.js';
import type { OdooClient } from './odoo.js';

/**
 * Odoo as a destination (PLAN-INTEGRATIONS-WOO-ODOO16 §4.3–4.7): contacts, products, sales
 * orders with their invoice, direct invoices, payments and credit notes. Business steps go
 * through Odoo's public buttons and wizards (O5). Every document gets an external id in the
 * `__agentor__` module, so a write that is repeated after a crash finds its record (O7).
 */

type Json = Record<string, unknown>;
type Warning = NonNullable<WriteResult['warnings']>[number];

export const XID_MODULE = '__agentor__';

interface RouteCtx {
  settings: Record<string, unknown>;
  mapping: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
}

const routeOf = (opts: WriteOptions): RouteCtx => ({
  settings: opts.route?.settings ?? {},
  mapping: opts.route?.mapping ?? {},
  tables: opts.route?.tables ?? {},
});

const bool = (r: RouteCtx, key: string, d: boolean) =>
  typeof r.settings[key] === 'boolean' ? (r.settings[key] as boolean) : d;
const str = (r: RouteCtx, key: string, d: string) => {
  const v = r.settings[key];
  return typeof v === 'string' && v ? v : d;
};
const id = (v: unknown): number | null => {
  const n = Number(v);
  return v !== '' && v !== null && v !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};
const m2oId = (v: unknown): number | null => (Array.isArray(v) ? Number(v[0]) : null);
const kr = (ore: number) => Math.round(ore) / 100;
const day = (iso: string) => iso.slice(0, 10);
const odooDatetime = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');

/** A name Odoo accepts as an external id: no dots, nothing exotic. */
export function xidName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
}

/** `woo_<connection>_order_<id>` back to its parts, for deliveries and invoices (§5.5). */
export function parseOrderXid(name: string): { connectionId: string; sourceId: string } | null {
  const m = /^[a-z]+_(.+)_order_([^_]+)$/.exec(name);
  return m ? { connectionId: m[1]!, sourceId: m[2]! } : null;
}

/** `sale.order,12` in Odoo's own reference format, so the id says which model it is. */
const ref = (model: string, rid: number) => `${model},${rid}`;
const parseRef = (v: string | null | undefined): { model: string; id: number } | null => {
  const m = /^([a-z_.]+),(\d+)$/.exec(v ?? '');
  return m ? { model: m[1]!, id: Number(m[2]) } : null;
};

/**
 * The mapping keys for a line's Odoo tax, most specific first (as `accountKeys` in the engine):
 * EU and export split goods and services, EU private customers book like domestic unless OSS.
 */
export function taxKeys(
  kind: SaleKind,
  vatRate: number,
  services: boolean,
  oss: boolean,
): string[] {
  const local = vatRate === 0 ? 'tax.vatFree' : 'tax.domestic';
  if (kind === 'euB2b') return services ? ['tax.euB2bServices', 'tax.euB2b'] : ['tax.euB2b'];
  if (kind === 'export') return services ? ['tax.exportServices', 'tax.export'] : ['tax.export'];
  if (kind === 'euB2c') return oss ? ['tax.euB2c'] : ['tax.euB2c', local];
  return [local];
}

interface TaxInfo {
  amount: number;
  amountType: string;
  priceInclude: boolean;
}

interface LineVals {
  product_id: number | false;
  name: string;
  quantity: number;
  price_unit: number;
  discount: number;
  tax_ids?: number[];
}

/** Lines in the order the shop sent them: products and fees, then shipping. */
interface SourceLine {
  line: OrderLine;
  name: string;
  productSetting?: string;
}

export class OdooWriter {
  private readonly countries = new Map<string, number | null>();
  private readonly currencies = new Map<string, number | null>();
  private readonly products = new Map<string, number | null>();
  private readonly taxes = new Map<number, TaxInfo | null>();

  constructor(
    private readonly client: OdooClient,
    private readonly companyId: number | null,
  ) {}

  /* -- External ids -- */

  async byXid(name: string): Promise<{ model: string; id: number } | null> {
    const [hit] = await this.client.searchRead<{ model: string; res_id: number }>(
      'ir.model.data',
      [
        ['module', '=', XID_MODULE],
        ['name', '=', xidName(name)],
      ],
      ['model', 'res_id'],
      { limit: 1 },
    );
    if (!hit) return null;
    const alive = await this.client.call<number>(hit.model, 'search_count', [
      [['id', '=', hit.res_id]],
    ]);
    return alive ? { model: hit.model, id: hit.res_id } : null;
  }

  /**
   * Gives a record its external id through `load` (id + .id columns), which registers the id
   * without needing write access to `ir.model.data`. A failure here is not fatal: the reference
   * search still finds the record.
   */
  async bindXid(model: string, rid: number, name: string): Promise<boolean> {
    try {
      const res = await this.client.call<{ ids: number[] | false; messages: { type: string }[] }>(
        model,
        'load',
        [['id', '.id'], [[`${XID_MODULE}.${xidName(name)}`, String(rid)]]],
      );
      return Boolean(res.ids) && !res.messages.some((m) => m.type === 'error');
    } catch {
      return false;
    }
  }

  /** The shop orders behind ERP records, from their external ids (§5.5). */
  async sourcesOf(
    model: string,
    ids: number[],
  ): Promise<Map<number, { connectionId: string; sourceId: string }>> {
    const out = new Map<number, { connectionId: string; sourceId: string }>();
    if (!ids.length) return out;
    const rows = await this.client.searchRead<{ name: string; res_id: number }>(
      'ir.model.data',
      [
        ['module', '=', XID_MODULE],
        ['model', '=', model],
        ['res_id', 'in', ids],
      ],
      ['name', 'res_id'],
    );
    for (const r of rows) {
      const src = parseOrderXid(r.name);
      if (src) out.set(r.res_id, src);
    }
    return out;
  }

  /* -- Small lookups -- */

  private async countryId(code: string | null | undefined): Promise<number | false> {
    const c = (code ?? '').toUpperCase();
    if (!c) return false;
    if (!this.countries.has(c)) {
      const [row] = await this.client.searchRead('res.country', [['code', '=', c]], ['id'], {
        limit: 1,
      });
      this.countries.set(c, row ? Number(row.id) : null);
    }
    return this.countries.get(c) ?? false;
  }

  private async currencyId(name: string): Promise<number | null> {
    if (!this.currencies.has(name)) {
      const [row] = await this.client.searchRead('res.currency', [['name', '=', name]], ['id'], {
        limit: 1,
        context: { active_test: false },
      });
      this.currencies.set(name, row ? Number(row.id) : null);
    }
    return this.currencies.get(name) ?? null;
  }

  private async taxInfo(ids: number[]): Promise<void> {
    const missing = [...new Set(ids.filter((x) => !this.taxes.has(x)))];
    if (!missing.length) return;
    const rows = await this.client.read<Json>('account.tax', missing, [
      'amount',
      'amount_type',
      'price_include',
    ]);
    for (const x of missing) this.taxes.set(x, null);
    for (const r of rows)
      this.taxes.set(Number(r.id), {
        amount: Number(r.amount),
        amountType: String(r.amount_type),
        priceInclude: r.price_include === true,
      });
  }

  /* -- Contacts (§4.3 contact.*) -- */

  private async partnerValues(
    c: Customer,
    r: RouteCtx,
    fields: Record<string, string>,
    create: boolean,
  ) {
    const update = new Set(
      Array.isArray(r.settings['contact.update'])
        ? (r.settings['contact.update'] as string[])
        : ['name', 'street', 'zip', 'city', 'country', 'phone', 'email'],
    );
    const all: Json = {
      name: (fields['partner.name'] || c.companyName || c.name).slice(0, 250),
      street: c.address.line1 ?? false,
      street2: c.address.line2 ?? false,
      zip: c.address.postalCode ?? false,
      city: c.address.city ?? false,
      country_id: await this.countryId(c.address.country),
      phone: c.phone ?? false,
      email: c.email ?? false,
      vat: c.vatNumber ?? (c.cvr ? `DK${c.cvr.replace(/\D/g, '')}` : false),
      is_company: c.kind === 'company',
    };
    const groups: Record<string, string[]> = {
      name: ['name', 'is_company'],
      street: ['street', 'street2'],
      zip: ['zip'],
      city: ['city'],
      country: ['country_id'],
      phone: ['phone'],
      email: ['email'],
      vat: ['vat'],
    };
    const vals: Json = {};
    for (const [group, keys] of Object.entries(groups))
      if (create || update.has(group)) for (const k of keys) vals[k] = all[k];
    // Odoo checks VAT numbers (VIES when switched on); an empty one is never sent.
    if (!vals.vat) delete vals.vat;
    if (fields['partner.ref']) vals.ref = fields['partner.ref'];
    if (fields['partner.comment']) vals.comment = fields['partner.comment'];
    Object.assign(vals, customFields(fields, 'partner.fields.'));
    if (create) vals.customer_rank = 1;
    return vals;
  }

  /** Finds or writes the contact; returns its id (null on a dry run without a match). */
  async partner(
    c: Customer,
    opts: WriteOptions,
    known: number | null = null,
  ): Promise<{ id: number | null; action: WriteResult['action'] }> {
    const r = routeOf(opts);
    const fields = opts.fields ?? {};
    const match = str(r, 'contact.match', 'email');
    if (match === 'none') {
      const shared = id(r.settings['contact.shared']);
      if (!shared)
        throw new WriteError('choose the shared Odoo contact (contact.shared)', 'invalid');
      return { id: shared, action: 'skip' };
    }
    // Already written as the order's dependency in this run (engine `refs`).
    if (known && opts.mode !== 'dry_run') return { id: known, action: 'skip' };
    const xid = fields['partner.externalId'] || `agentor_customer_${c.sourceId}`;
    let pid = known ?? (await this.byXid(xid))?.id ?? null;
    if (!pid) {
      const domain: unknown[] | null =
        match === 'email' && c.email
          ? [['email', '=ilike', c.email]]
          : match === 'vat' && c.vatNumber
            ? [['vat', '=', c.vatNumber]]
            : match === 'ref' && fields['partner.ref']
              ? [['ref', '=', fields['partner.ref']]]
              : null;
      if (domain) {
        const [hit] = await this.client.searchRead(
          'res.partner',
          [...domain, ['parent_id', '=', false]],
          ['id'],
          { limit: 1, order: 'id asc' },
        );
        pid = hit ? Number(hit.id) : null;
      }
    }
    if (opts.mode === 'dry_run') return { id: pid, action: pid ? 'update' : 'create' };
    if (pid) {
      await this.client.call('res.partner', 'write', [
        [pid],
        await this.partnerValues(c, r, fields, false),
      ]);
      await this.bindXid('res.partner', pid, xid);
      return { id: pid, action: 'update' };
    }
    pid = await this.client.call<number>('res.partner', 'create', [
      await this.partnerValues(c, r, fields, true),
    ]);
    await this.bindXid('res.partner', pid, xid);
    return { id: pid, action: 'create' };
  }

  /** A delivery address under the contact when the order ships elsewhere (contact.shippingAddress). */
  private async deliveryAddress(parent: number, o: Order, r: RouteCtx): Promise<number> {
    const to = o.shippingTo;
    if (
      str(r, 'contact.shippingAddress', 'childDelivery') !== 'childDelivery' ||
      !to?.address.line1
    )
      return parent;
    const b = o.billing?.address;
    if (b && b.line1 === to.address.line1 && b.postalCode === to.address.postalCode) return parent;
    const vals = {
      parent_id: parent,
      type: 'delivery',
      name: (to.company || to.name || o.customer.name).slice(0, 250),
      street: to.address.line1,
      street2: to.address.line2 ?? false,
      zip: to.address.postalCode ?? false,
      city: to.address.city ?? false,
      country_id: await this.countryId(to.address.country),
      phone: to.phone ?? false,
    };
    const [hit] = await this.client.searchRead(
      'res.partner',
      [
        ['parent_id', '=', parent],
        ['type', '=', 'delivery'],
        ['street', '=', vals.street],
        ['zip', '=', vals.zip],
      ],
      ['id'],
      { limit: 1 },
    );
    return hit ? Number(hit.id) : this.client.call<number>('res.partner', 'create', [vals]);
  }

  /* -- Products (§4.3 products.*) -- */

  private async productFor(
    l: OrderLine,
    r: RouteCtx,
    mode: WriteOptions['mode'],
    fallback?: string,
  ): Promise<number | false> {
    if (fallback) {
      const fixed = id(r.settings[fallback]);
      if (fixed) return fixed;
    }
    const match = str(r, 'products.match', 'sku');
    const key = match === 'barcode' ? l.ean : match === 'none' ? null : l.sku;
    if (key) {
      const cacheKey = `${match}:${key}`;
      if (!this.products.has(cacheKey)) {
        const [hit] = await this.client.searchRead(
          'product.product',
          [[match === 'barcode' ? 'barcode' : 'default_code', '=', key]],
          ['id'],
          { limit: 1 },
        );
        this.products.set(cacheKey, hit ? Number(hit.id) : null);
      }
      const hit = this.products.get(cacheKey);
      if (hit) return hit;
    }
    const missing = str(r, 'products.missing', 'useGeneric');
    if (missing === 'create' && l.sku && match !== 'none') {
      if (mode === 'dry_run') return false;
      const created = await this.client.call<number>('product.product', 'create', [
        {
          name: l.name.slice(0, 250),
          default_code: l.sku,
          ...(l.ean ? { barcode: l.ean } : {}),
          list_price: kr(l.unitPrice),
          detailed_type: str(r, 'products.type', 'consu'),
          ...(id(r.settings['products.categoryId'])
            ? { categ_id: id(r.settings['products.categoryId']) }
            : {}),
        },
      ]);
      this.products.set(`${match}:${l.sku}`, created);
      return created;
    }
    if (missing === 'fail' && key)
      throw new WriteError(`the product ${key} is not in Odoo`, 'invalid');
    const generic = id(r.settings['products.genericId']);
    if (!generic)
      throw new WriteError(
        `no Odoo product for "${l.name}": choose a standard product (products.genericId)`,
        'invalid',
      );
    return generic;
  }

  async writeProduct(p: Product, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const xid = opts.fields?.['product.externalId'] || `agentor_product_${p.sourceId}`;
    let pid =
      (parseRef(opts.existingId)?.id ?? id(opts.existingId)) || (await this.byXid(xid))?.id || null;
    if (!pid && p.sku) {
      const [hit] = await this.client.searchRead(
        'product.product',
        [['default_code', '=', p.sku]],
        ['id'],
        {
          limit: 1,
        },
      );
      pid = hit ? Number(hit.id) : null;
    }
    if (opts.mode === 'dry_run') return { action: pid ? 'update' : 'create', destinationId: null };
    const vals: Json = {
      name: p.name.slice(0, 250),
      ...(p.sku ? { default_code: p.sku } : {}),
      ...(p.ean ? { barcode: p.ean } : {}),
      list_price: kr(p.price),
    };
    if (pid) {
      if (!bool(r, 'product.update', true)) return { action: 'skip', destinationId: String(pid) };
      await this.client.call('product.product', 'write', [[pid], vals]);
      await this.bindXid('product.product', pid, xid);
      return { action: 'update', destinationId: String(pid) };
    }
    if (!bool(r, 'product.create', true)) return { action: 'skip', destinationId: null };
    pid = await this.client.call<number>('product.product', 'create', [
      {
        ...vals,
        detailed_type: str(r, 'products.type', 'consu'),
        ...(id(r.settings['products.categoryId'])
          ? { categ_id: id(r.settings['products.categoryId']) }
          : {}),
      },
    ]);
    await this.bindXid('product.product', pid, xid);
    return { action: 'create', destinationId: String(pid) };
  }

  /* -- Lines and taxes (§4.3 tax.*, lines) -- */

  private sourceLines(
    o: Pick<Order, 'lines' | 'shipping' | 'shippingVatRate' | 'shippingMethod'>,
    lineFields: Record<string, string>[],
  ): SourceLine[] {
    const out: SourceLine[] = o.lines.map((l, i) => ({
      line: l,
      name: lineFields[i]?.['line.name'] || l.name,
      ...(l.kind === 'fee' ? { productSetting: 'fees.productId' } : {}),
    }));
    if (o.shipping > 0)
      out.push({
        line: {
          sku: null,
          productId: null,
          name: o.shippingMethod || 'Fragt',
          quantity: 1,
          unitPrice: o.shipping,
          vatRate: o.shippingVatRate,
          category: null,
          kind: 'fee',
        },
        name: o.shippingMethod || 'Fragt',
        productSetting: 'shipping.productId',
      });
    return out;
  }

  /**
   * Odoo lines with taxes by `tax.strategy` (O8). `shopTax` books the VAT the shop charged
   * through the tax mapping and sends prices the way the chosen tax expects them; `odoo` leaves
   * taxes to Odoo's products and fiscal positions.
   */
  private async lines(
    kind: SaleKind,
    src: SourceLine[],
    r: RouteCtx,
    mode: WriteOptions['mode'],
    warnings: Warning[],
    sign = 1,
  ): Promise<LineVals[]> {
    const shopTax = str(r, 'tax.strategy', 'shopTax') === 'shopTax';
    const oss = r.settings['oss.mode'] === 'destinationVat';
    const verify = str(r, 'tax.verify', 'warn');
    const chosen = src.map(({ line }) => {
      if (!shopTax) return { key: null, tax: null };
      const keys = taxKeys(kind, line.vatRate, line.supplyType === 'services', oss);
      const key = keys.find((k) => r.mapping[k]) ?? keys[keys.length - 1]!;
      return { key, tax: id(r.mapping[key]) };
    });
    await this.taxInfo(chosen.map((c) => c.tax).filter((x): x is number => x !== null));
    const out: LineVals[] = [];
    for (const [i, s] of src.entries()) {
      const l = s.line;
      const { key, tax } = chosen[i]!;
      if (shopTax && !tax && l.vatRate > 0)
        throw new WriteError(
          `no Odoo tax chosen for ${key} (${Math.round(l.vatRate * 1000) / 10} %)`,
          'invalid',
        );
      const info = tax ? this.taxes.get(tax) : null;
      if (info && info.amountType === 'percent' && Math.abs(info.amount - l.vatRate * 100) > 0.05) {
        const params = {
          line: l.name,
          shop: String(Math.round(l.vatRate * 1000) / 10),
          odoo: String(info.amount),
        };
        if (verify === 'fail')
          throw new WriteError(
            `Odoo's tax is ${params.odoo} % but the shop charged ${params.shop} % on "${l.name}"`,
            'invalid',
          );
        if (verify === 'warn') warnings.push({ code: 'VAT_RATE_MISMATCH', params });
      }
      const qty = Math.abs(l.quantity);
      const gross = l.unitPrice * qty;
      const incl = info?.priceInclude && info.amountType === 'percent';
      out.push({
        product_id: await this.productFor(l, r, mode, s.productSetting),
        name: s.name.slice(0, 2000),
        quantity: qty * sign,
        price_unit: incl
          ? Math.round(l.unitPrice * (1 + info.amount / 100)) / 100
          : kr(l.unitPrice),
        discount:
          gross > 0 && l.discount
            ? Math.min(Math.round((l.discount / gross) * 10000) / 100, 100)
            : 0,
        ...(shopTax ? { tax_ids: tax ? [tax] : [] } : {}),
      });
    }
    return out;
  }

  private fiscalPosition(kind: SaleKind, r: RouteCtx): Json {
    if (str(r, 'tax.strategy', 'shopTax') === 'shopTax') return { fiscal_position_id: false };
    const fp = id(r.mapping[`fiscal.${kind}`]);
    return fp ? { fiscal_position_id: fp } : {};
  }

  /**
   * Odoo's total against the shop's (rounding.policy). Small differences become a line on the
   * rounding product; anything above the limit fails the record.
   */
  private async settleTotal(
    model: 'sale.order' | 'account.move',
    rid: number,
    shopTotal: number,
    r: RouteCtx,
    warnings: Warning[],
  ): Promise<void> {
    const [row] = await this.client.read<{ amount_total: number }>(model, [rid], ['amount_total']);
    const diff = shopTotal - Math.round(Number(row?.amount_total ?? 0) * 100);
    if (Math.abs(diff) < 1) return;
    const policy = str(r, 'rounding.policy', 'line');
    const max = Math.round(Number(r.settings['rounding.maxDiff'] ?? 1) * 100);
    const params = {
      diff: String(kr(diff)),
      odoo: String(row?.amount_total ?? 0),
      shop: String(kr(shopTotal)),
    };
    if (policy === 'fail' || Math.abs(diff) > max)
      throw new WriteError(
        `Odoo's total ${params.odoo} differs from the shop's ${params.shop}`,
        'invalid',
      );
    if (policy === 'ignoreBelow') {
      warnings.push({ code: 'TOTAL_ROUNDED', params });
      return;
    }
    const product = id(r.settings['rounding.productId']);
    if (!product)
      throw new WriteError('choose a rounding product in Odoo (rounding.productId)', 'invalid');
    const line = { product_id: product, name: 'Øreafrunding', price_unit: kr(diff), discount: 0 };
    await this.client.call(model, 'write', [
      [rid],
      model === 'sale.order'
        ? { order_line: [[0, 0, { ...line, product_uom_qty: 1, tax_id: [[6, 0, []]] }]] }
        : { invoice_line_ids: [[0, 0, { ...line, quantity: 1, tax_ids: [[6, 0, []]] }]] },
    ]);
    warnings.push({ code: 'TOTAL_ROUNDED', params });
  }

  /* -- Orders (§4.6) -- */

  private async findOrder(
    o: Order,
    opts: WriteOptions,
  ): Promise<{ model: string; id: number } | null> {
    const known = parseRef(opts.existingId);
    if (known) {
      const alive = await this.client.call<number>(known.model, 'search_count', [
        [['id', '=', known.id]],
      ]);
      if (alive) return known;
    }
    const fields = opts.fields ?? {};
    const byXid = await this.byXid(fields['order.externalId'] || `agentor_order_${o.sourceId}`);
    if (byXid) return byXid;
    // The external id is written right after the record; a crash in between is caught here.
    const clientRef = fields['order.clientRef'];
    const origin = fields['order.origin'];
    if (clientRef && origin) {
      const [so] = await this.client.searchRead(
        'sale.order',
        [
          ['client_order_ref', '=', clientRef],
          ['origin', '=', origin],
        ],
        ['id'],
        { limit: 1 },
      );
      if (so) return { model: 'sale.order', id: Number(so.id) };
      const [inv] = await this.client.searchRead(
        'account.move',
        [
          ['move_type', '=', 'out_invoice'],
          ['ref', '=', fields['invoice.ref'] ?? clientRef],
          ['invoice_origin', '=', origin],
        ],
        ['id'],
        { limit: 1 },
      );
      if (inv) return { model: 'account.move', id: Number(inv.id) };
    }
    return null;
  }

  async writeOrder(o: Order, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const fields = opts.fields ?? {};
    const warnings: Warning[] = [];
    const done = (res: WriteResult): WriteResult => (warnings.length ? { ...res, warnings } : res);
    const existing = await this.findOrder(o, opts);

    // A cancelled order (§4.7): cancel what can be cancelled, never undo booked work.
    if (o.status === 'cancelled') {
      if (!existing) return { action: 'skip', destinationId: null };
      if (opts.mode === 'dry_run') return { action: 'update', destinationId: null };
      return done(await this.cancel(existing, r, warnings));
    }

    const posting = str(r, 'posting.type', 'saleOrderAndInvoice');
    const kind = saleKind(o);
    const pre = await this.partner(
      o.customer,
      opts,
      id(opts.refs?.[`customer:${o.customer.sourceId}`]),
    );
    const src = this.sourceLines(o, opts.lineFields ?? []);
    if (!src.length) throw new WriteError('the order has no lines', 'invalid');
    const lines = await this.lines(kind, src, r, opts.mode, warnings);
    if (opts.mode === 'dry_run')
      return done({ action: existing ? 'update' : 'create', destinationId: null });
    const partnerId = pre.id!;
    const shippingId = await this.deliveryAddress(partnerId, o, r);
    const xid = fields['order.externalId'] || `agentor_order_${o.sourceId}`;

    if (posting === 'invoice' || existing?.model === 'account.move')
      return done(
        await this.directInvoice(
          o,
          opts,
          r,
          existing?.id ?? null,
          partnerId,
          shippingId,
          lines,
          kind,
          xid,
          warnings,
        ),
      );

    // Sales order (+ invoice).
    let soId = existing?.id ?? null;
    let action: WriteResult['action'] = 'create';
    const pricelist = await this.pricelistFor(o, r);
    const header: Json = {
      partner_id: partnerId,
      partner_invoice_id: partnerId,
      partner_shipping_id: shippingId,
      client_order_ref: fields['order.clientRef'] || o.number,
      origin: fields['order.origin'] || `WooCommerce ${o.number}`,
      date_order: odooDatetime(o.createdAt),
      ...(fields['order.note'] ? { note: fields['order.note'] } : {}),
      ...(pricelist ? { pricelist_id: pricelist } : {}),
      ...(id(r.settings.warehouseId) ? { warehouse_id: id(r.settings.warehouseId) } : {}),
      ...(id(r.settings['team.id']) ? { team_id: id(r.settings['team.id']) } : {}),
      ...(id(r.settings['user.id']) ? { user_id: id(r.settings['user.id']) } : {}),
      ...(this.companyId ? { company_id: this.companyId } : {}),
      ...this.fiscalPosition(kind, r),
      ...customFields(fields, 'order.fields.'),
    };
    const orderLines = lines.map(({ quantity, tax_ids, ...l }) => ({
      ...l,
      product_uom_qty: quantity,
      ...(tax_ids ? { tax_id: [[6, 0, tax_ids]] } : {}),
    }));
    let state = 'draft';
    if (soId) {
      const [so] = await this.client.read<{ state: string; amount_total: number }>(
        'sale.order',
        [soId],
        ['state', 'amount_total'],
      );
      state = so?.state ?? 'draft';
      if (state === 'draft' || state === 'sent') {
        if (bool(r, 'invoice.updateDrafts', true)) {
          await this.client.call('sale.order', 'write', [
            [soId],
            { ...header, order_line: [[5, 0, 0], ...orderLines.map((l) => [0, 0, l])] },
          ]);
          await this.settleTotal('sale.order', soId, o.total, r, warnings);
          action = 'update';
        } else action = 'skip';
      } else {
        // Never amend a confirmed order (D5); say so when the shop's total moved.
        if (Math.abs(Math.round(Number(so?.amount_total ?? 0) * 100) - o.total) >= 100)
          warnings.push({ code: 'CHANGED_AFTER_BOOKING', params: { order: o.number } });
        action = 'update';
      }
    } else {
      soId = await this.client.call<number>('sale.order', 'create', [
        { ...header, order_line: orderLines.map((l) => [0, 0, l]) },
      ]);
      await this.bindXid('sale.order', soId, xid);
      await this.settleTotal('sale.order', soId, o.total, r, warnings);
    }
    const destinationId = ref('sale.order', soId);
    // Kladde: a quotation and nothing more (route mode draft).
    if (opts.mode !== 'live')
      return { action, destinationId, ...(warnings.length ? { warnings } : {}) };
    if ((state === 'draft' || state === 'sent') && bool(r, 'order.confirm', true)) {
      await this.client.call('sale.order', 'action_confirm', [[soId]]);
      state = 'sale';
    }
    if (posting === 'saleOrderAndInvoice' && state === 'sale') {
      const inv = await this.invoiceForOrder(soId, o, r, warnings);
      if (inv) await this.finishInvoice(inv, o, opts, r, warnings);
    }
    return { action, destinationId, ...(warnings.length ? { warnings } : {}) };
  }

  /** A price list in the order's currency, when the shop sold in another currency (§4.3 currency). */
  private async pricelistFor(o: Order, r: RouteCtx): Promise<number | null> {
    const fixed = id(r.settings.pricelistId);
    if (fixed) return fixed;
    if (str(r, 'currency', 'order') !== 'order' || !o.currency) return null;
    const [company] = this.companyId
      ? await this.client.read<{ currency_id: unknown }>(
          'res.company',
          [this.companyId],
          ['currency_id'],
        )
      : [];
    const companyCurrency = Array.isArray(company?.currency_id)
      ? String(company.currency_id[1])
      : 'DKK';
    if (o.currency === companyCurrency) return null;
    const [pl] = await this.client.searchRead(
      'product.pricelist',
      [['currency_id.name', '=', o.currency]],
      ['id'],
      { limit: 1 },
    );
    if (!pl) throw new WriteError(`Odoo has no price list in ${o.currency}`, 'invalid');
    return Number(pl.id);
  }

  /**
   * The order's invoice (§4.3 order.invoiceWhen): the existing one, or a new regular invoice
   * through `sale.advance.payment.inv` when the moment has come.
   */
  private async invoiceForOrder(
    soId: number,
    o: Order,
    r: RouteCtx,
    warnings: Warning[],
  ): Promise<number | null> {
    const [so] = await this.client.read<{ invoice_ids: number[]; invoice_status: string }>(
      'sale.order',
      [soId],
      ['invoice_ids', 'invoice_status'],
    );
    if (so?.invoice_ids.length) {
      const invs = await this.client.read<{ id: number; move_type: string; state: string }>(
        'account.move',
        so.invoice_ids,
        ['move_type', 'state'],
      );
      const inv = invs.find((x) => x.move_type === 'out_invoice' && x.state !== 'cancel');
      if (inv) return inv.id;
    }
    const when = str(r, 'order.invoiceWhen', 'onPaid');
    const ready =
      when === 'onConfirm' ||
      (when === 'onPaid' && Boolean(o.paidAt)) ||
      (when === 'onDelivered' && so?.invoice_status === 'to invoice');
    if (!ready) return null;
    const ctx = { active_model: 'sale.order', active_ids: [soId], active_id: soId };
    try {
      const wizard = await this.client.call<number>(
        'sale.advance.payment.inv',
        'create',
        [{ advance_payment_method: 'delivered' }],
        { context: ctx },
      );
      await this.client.call('sale.advance.payment.inv', 'create_invoices', [[wizard]], {
        context: ctx,
      });
    } catch (e) {
      // Products invoiced on delivered quantities have nothing to invoice before delivery.
      if (
        e instanceof WriteError &&
        e.kind === 'invalid' &&
        /invoiceable|nothing to invoice|fakturerbar/i.test(e.message)
      ) {
        warnings.push({ code: 'INVOICE_NOT_READY', params: { order: o.number } });
        return null;
      }
      throw e;
    }
    const [after] = await this.client.read<{ invoice_ids: number[] }>(
      'sale.order',
      [soId],
      ['invoice_ids'],
    );
    const invs = await this.client.read<{ id: number; move_type: string; state: string }>(
      'account.move',
      after?.invoice_ids ?? [],
      ['move_type', 'state'],
    );
    return (
      invs.filter((x) => x.move_type === 'out_invoice' && x.state === 'draft').at(-1)?.id ?? null
    );
  }

  private async directInvoice(
    o: Order,
    opts: WriteOptions,
    r: RouteCtx,
    existing: number | null,
    partnerId: number,
    shippingId: number,
    lines: LineVals[],
    kind: SaleKind,
    xid: string,
    warnings: Warning[],
  ): Promise<WriteResult> {
    const fields = opts.fields ?? {};
    const currency = o.currency ? await this.currencyId(o.currency) : null;
    const header: Json = {
      move_type: 'out_invoice',
      partner_id: partnerId,
      partner_shipping_id: shippingId,
      invoice_date: this.invoiceDate(o, r),
      ref: fields['invoice.ref'] || o.number,
      payment_reference: fields['invoice.paymentReference'] || o.number,
      invoice_origin: fields['order.origin'] || `WooCommerce ${o.number}`,
      ...(fields['invoice.narration'] ? { narration: fields['invoice.narration'] } : {}),
      ...(currency && str(r, 'currency', 'order') === 'order' ? { currency_id: currency } : {}),
      ...(id(r.settings['invoice.journalId'])
        ? { journal_id: id(r.settings['invoice.journalId']) }
        : {}),
      ...(this.companyId ? { company_id: this.companyId } : {}),
      ...this.fiscalPosition(kind, r),
      ...customFields(fields, 'invoice.fields.'),
    };
    const invLines = lines.map(({ tax_ids, ...l }) => ({
      ...l,
      ...(tax_ids ? { tax_ids: [[6, 0, tax_ids]] } : {}),
    }));
    let action: WriteResult['action'] = 'create';
    let invId = existing;
    if (invId) {
      const [inv] = await this.client.read<{ state: string; amount_total: number }>(
        'account.move',
        [invId],
        ['state', 'amount_total'],
      );
      if (inv?.state === 'draft' && bool(r, 'invoice.updateDrafts', true)) {
        const { move_type: _t, ...rest } = header;
        await this.client.call('account.move', 'write', [
          [invId],
          { ...rest, invoice_line_ids: [[5, 0, 0], ...invLines.map((l) => [0, 0, l])] },
        ]);
        await this.settleTotal('account.move', invId, o.total, r, warnings);
        action = 'update';
      } else {
        if (
          inv &&
          inv.state !== 'draft' &&
          Math.abs(Math.round(Number(inv.amount_total) * 100) - o.total) >= 100
        )
          warnings.push({ code: 'CHANGED_AFTER_BOOKING', params: { order: o.number } });
        action = inv?.state === 'draft' ? 'skip' : 'update';
      }
    } else {
      invId = await this.client.call<number>('account.move', 'create', [
        { ...header, invoice_line_ids: invLines.map((l) => [0, 0, l]) },
      ]);
      await this.bindXid('account.move', invId, xid);
      await this.settleTotal('account.move', invId, o.total, r, warnings);
    }
    if (opts.mode === 'live') await this.finishInvoice(invId, o, opts, r, warnings);
    return { action, destinationId: ref('account.move', invId) };
  }

  private invoiceDate(o: Order, r: RouteCtx): string {
    const when = str(r, 'invoice.date', 'paid');
    if (when === 'today') return day(new Date().toISOString());
    if (when === 'order') return day(o.createdAt);
    return day(o.paidAt ?? o.createdAt);
  }

  /** Texts, post, payment and e-mail on an invoice (§4.3 invoice.post, payment.*, send.email). */
  private async finishInvoice(
    invId: number,
    o: Order,
    opts: WriteOptions,
    r: RouteCtx,
    warnings: Warning[],
  ) {
    const fields = opts.fields ?? {};
    let [inv] = await this.client.read<{
      state: string;
      payment_state: string;
      is_move_sent?: boolean;
    }>('account.move', [invId], ['state', 'payment_state', 'is_move_sent']);
    if (inv?.state === 'draft') {
      await this.client.call('account.move', 'write', [
        [invId],
        {
          invoice_date: this.invoiceDate(o, r),
          ref: fields['invoice.ref'] || o.number,
          payment_reference: fields['invoice.paymentReference'] || o.number,
          ...(fields['invoice.narration'] ? { narration: fields['invoice.narration'] } : {}),
          ...customFields(fields, 'invoice.fields.'),
        },
      ]);
      if (!bool(r, 'invoice.post', false)) return;
      await this.post(invId, r);
      [inv] = await this.client.read(
        'account.move',
        [invId],
        ['state', 'payment_state', 'is_move_sent'],
      );
    }
    if (inv?.state !== 'posted') return;
    if (
      o.paidAt &&
      bool(r, 'payment.register', true) &&
      (inv.payment_state === 'not_paid' || inv.payment_state === 'partial')
    )
      await this.pay(
        invId,
        o.paymentMethod?.id ?? '',
        o.paidAt,
        fields['payment.memo'] || null,
        r,
        warnings,
      );
    if (bool(r, 'send.email', false) && !inv.is_move_sent) await this.sendEmail(invId, r);
  }

  /** Posts, moving the date to today when the period is locked and the route allows it. */
  private async post(moveId: number, r: RouteCtx) {
    try {
      await this.client.call('account.move', 'action_post', [[moveId]]);
    } catch (e) {
      if (
        e instanceof WriteError &&
        e.kind === 'invalid' &&
        /lock date|låsedato/i.test(e.message) &&
        str(r, 'invoice.lockedPeriod', 'moveToToday') === 'moveToToday'
      ) {
        await this.client.call('account.move', 'write', [
          [moveId],
          { invoice_date: day(new Date().toISOString()) },
        ]);
        await this.client.call('account.move', 'action_post', [[moveId]]);
        return;
      }
      throw e;
    }
  }

  /** Registers the payment through Odoo's wizard (D6), with the journal from the payment-method table. */
  private async pay(
    moveId: number,
    method: string,
    paidAt: string,
    memo: string | null,
    r: RouteCtx,
    warnings: Warning[],
  ) {
    const row = (r.tables.paymentMethods ?? []).find((x) => x.from === method);
    const journal = id(row?.journal) ?? id(r.settings['payment.journalId']);
    if (!journal) {
      warnings.push({ code: 'PAYMENT_NOT_REGISTERED', params: { method: method || '-' } });
      return;
    }
    const ctx = {
      active_model: 'account.move',
      active_ids: [moveId],
      dont_redirect_to_payments: true,
    };
    const wizard = await this.client.call<number>(
      'account.payment.register',
      'create',
      [
        {
          journal_id: journal,
          payment_date: day(paidAt),
          ...(memo ? { communication: memo.slice(0, 250) } : {}),
          ...(id(row?.method) ? { payment_method_line_id: id(row?.method) } : {}),
          payment_difference_handling: str(r, 'payment.differenceHandling', 'open'),
          ...(id(r.settings['payment.writeoffAccountId'])
            ? { writeoff_account_id: id(r.settings['payment.writeoffAccountId']) }
            : {}),
        },
      ],
      { context: ctx },
    );
    await this.client.call('account.payment.register', 'action_create_payments', [[wizard]], {
      context: ctx,
    });
  }

  private async sendEmail(moveId: number, r: RouteCtx) {
    let template = id(r.settings['send.templateId']);
    if (!template) {
      const [x] = await this.client.searchRead<{ res_id: number }>(
        'ir.model.data',
        [
          ['module', '=', 'account'],
          ['name', '=', 'email_template_edi_invoice'],
        ],
        ['res_id'],
        { limit: 1 },
      );
      template = x?.res_id ?? null;
    }
    if (!template) return;
    await this.client.call('account.move', 'message_post_with_template', [[moveId], template], {
      composition_mode: 'comment',
    });
    await this.client.call('account.move', 'write', [[moveId], { is_move_sent: true }]);
  }

  private async cancel(
    existing: { model: string; id: number },
    r: RouteCtx,
    warnings: Warning[],
  ): Promise<WriteResult> {
    const destinationId = ref(existing.model, existing.id);
    if (existing.model === 'sale.order') {
      const [so] = await this.client.read<{ state: string; invoice_ids: number[] }>(
        'sale.order',
        [existing.id],
        ['state', 'invoice_ids'],
      );
      const invoices = so?.invoice_ids.length
        ? await this.client.read<{ state: string }>('account.move', so.invoice_ids, ['state'])
        : [];
      const booked = invoices.some((i) => i.state === 'posted');
      if (so?.state === 'cancel') return { action: 'skip', destinationId };
      const quotation = so?.state === 'draft' || so?.state === 'sent';
      const allowed = quotation
        ? str(r, 'cancel.quotation', 'cancel') === 'cancel'
        : !booked && str(r, 'cancel.confirmed', 'cancel') === 'cancel';
      if (!allowed) {
        warnings.push({ code: 'CHANGED_AFTER_BOOKING', params: { order: String(existing.id) } });
        return { action: 'skip', destinationId };
      }
      // Without the flag Odoo answers with a "send cancellation e-mail?" dialog instead.
      await this.client.call('sale.order', 'action_cancel', [[existing.id]], {
        context: { disable_cancel_warning: true },
      });
      return { action: 'update', destinationId };
    }
    const [inv] = await this.client.read<{ state: string }>(
      'account.move',
      [existing.id],
      ['state'],
    );
    if (inv?.state === 'draft') {
      await this.client.call('account.move', 'button_cancel', [[existing.id]]);
      return { action: 'update', destinationId };
    }
    warnings.push({ code: 'CHANGED_AFTER_BOOKING', params: { order: String(existing.id) } });
    return { action: 'skip', destinationId };
  }

  /* -- Credit notes (§4.3 Kreditnotaer) -- */

  async writeCreditNote(cn: CreditNote, opts: WriteOptions): Promise<WriteResult> {
    const r = routeOf(opts);
    const fields = opts.fields ?? {};
    const warnings: Warning[] = [];
    const xid = fields['creditNote.externalId'] || `agentor_refund_${cn.sourceId}`;
    const known = parseRef(opts.existingId) ?? (await this.byXid(xid));
    if (known) return { action: 'skip', destinationId: ref(known.model, known.id) };
    const order = await this.byXid(
      fields['creditNote.orderExternalId'] || `agentor_order_${cn.orderSourceId}`,
    );
    const orderNo = cn.meta?.orderNumber ?? cn.orderSourceId;
    if (!order) throw new WriteError(`order ${orderNo} is not in Odoo`, 'invalid');
    const invoiceIds =
      order.model === 'account.move'
        ? [order.id]
        : ((
            await this.client.read<{ invoice_ids: number[] }>(
              'sale.order',
              [order.id],
              ['invoice_ids'],
            )
          )[0]?.invoice_ids ?? []);
    const invoices = await this.client.read<{
      id: number;
      move_type: string;
      state: string;
      partner_id: unknown;
      journal_id: unknown;
      currency_id: unknown;
      fiscal_position_id: unknown;
      amount_total: number;
      name: string;
    }>('account.move', invoiceIds, [
      'move_type',
      'state',
      'partner_id',
      'journal_id',
      'currency_id',
      'fiscal_position_id',
      'amount_total',
      'name',
    ]);
    const inv = invoices.find((i) => i.move_type === 'out_invoice' && i.state === 'posted');
    if (!inv)
      // The refund waits until Odoo has invoiced the order, then it is retried.
      throw new WriteError(`order ${orderNo} is not invoiced in Odoo yet`, 'transient', 3_600_000);
    const kind = saleKind({ customer: cn.customer, lines: cn.lines });
    const lines = await this.lines(
      kind,
      this.sourceLines(
        { lines: cn.lines, shipping: 0, shippingVatRate: 0, shippingMethod: null },
        opts.lineFields ?? [],
      ),
      r,
      opts.mode,
      warnings,
    );
    if (opts.mode === 'dry_run')
      return { action: 'create', destinationId: null, ...(warnings.length ? { warnings } : {}) };
    const full = Math.abs(Math.round(inv.amount_total * 100) - cn.total) < 1;
    let refundId: number;
    if (full && str(r, 'creditNote.mode', 'standalone') === 'reversal') {
      const ctx = { active_model: 'account.move', active_ids: [inv.id] };
      const wizard = await this.client.call<number>(
        'account.move.reversal',
        'create',
        [
          {
            refund_method: 'refund',
            reason: (fields['creditNote.ref'] || cn.reason || '').slice(0, 250),
            date: day(cn.createdAt),
          },
        ],
        { context: ctx },
      );
      await this.client.call('account.move.reversal', 'reverse_moves', [[wizard]], {
        context: ctx,
      });
      const [made] = await this.client.searchRead(
        'account.move',
        [['reversed_entry_id', '=', inv.id]],
        ['id'],
        {
          limit: 1,
          order: 'id desc',
        },
      );
      if (!made) throw new WriteError('Odoo did not create the credit note', 'transient');
      refundId = Number(made.id);
    } else {
      refundId = await this.client.call<number>('account.move', 'create', [
        {
          move_type: 'out_refund',
          partner_id: m2oId(inv.partner_id),
          reversed_entry_id: inv.id,
          invoice_origin: inv.name,
          invoice_date: day(cn.createdAt),
          ref: fields['creditNote.ref'] || `Refusion ${cn.number} for ordre ${orderNo}`,
          journal_id: m2oId(inv.journal_id),
          currency_id: m2oId(inv.currency_id),
          fiscal_position_id: m2oId(inv.fiscal_position_id) ?? false,
          invoice_line_ids: lines.map(({ tax_ids, ...l }) => [
            0,
            0,
            { ...l, ...(tax_ids ? { tax_ids: [[6, 0, tax_ids]] } : {}) },
          ]),
        },
      ]);
    }
    await this.bindXid('account.move', refundId, xid);
    if (opts.mode === 'live' && bool(r, 'creditNote.post', false)) {
      await this.post(refundId, r);
      if (cn.refundsPayment && bool(r, 'creditNote.registerRefund', false))
        await this.pay(
          refundId,
          cn.meta?.paymentMethod ?? '',
          cn.createdAt,
          cn.reason ?? null,
          r,
          warnings,
        );
    }
    return {
      action: 'create',
      destinationId: ref('account.move', refundId),
      ...(warnings.length ? { warnings } : {}),
    };
  }
}

/**
 * Values for the customer's own Odoo fields from the route's templates or expressions (§4.5):
 * target keys `order.fields.x_…`. Numbers (and relation ids from an expression) are sent as
 * numbers.
 */
export function customFields(fields: Record<string, string>, prefix: string): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith(prefix) || v === '') continue;
    const name = k.slice(prefix.length);
    if (!/^x_[a-z0-9_]+$/.test(name)) continue;
    out[name] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}
