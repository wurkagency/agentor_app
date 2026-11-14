import { describe, expect, it } from 'vitest';
import {
  odoo,
  settingValue,
  WriteError,
  type CreditNote,
  type Customer,
  type Order,
  type WriteOptions,
} from '../src/index.js';
import { openAdapter, parseOrderXid, taxKeys, xidName } from '../src/live/index.js';
import { fakeOdoo, type FakeOdooDb } from './fake-odoo.js';

/** Odoo as a destination against a recorded database (PLAN-INTEGRATIONS-WOO-ODOO16 P2). */

const CREDS = {
  baseUrl: 'https://odoo.nordlys.example',
  database: 'nordlys',
  login: 'agentor@nordlys.example',
  apiKey: 'key-ok',
};

function database(): FakeOdooDb {
  return {
    tables: {
      'res.country': [
        { id: 59, code: 'DK' },
        { id: 57, code: 'DE' },
      ],
      'res.partner': [{ id: 8, name: 'Line Kjær', email: 'line.kjaer@example.dk' }],
      'product.product': [
        { id: 10, default_code: 'E7-M', barcode: '5700000000010' },
        { id: 20, default_code: 'WEB', name: 'Webshopvare' },
        { id: 21, default_code: 'FRAGT', name: 'Fragt' },
        { id: 22, default_code: 'ORE', name: 'Øreafrunding' },
      ],
      'account.tax': [
        { id: 1, amount: 25, amount_type: 'percent', price_include: false },
        { id: 2, amount: 25, amount_type: 'percent', price_include: true },
        { id: 3, amount: 0, amount_type: 'percent', price_include: false },
      ],
      'sale.order': [],
      'account.move': [],
      'ir.model.data': [
        {
          id: 1,
          module: 'account',
          name: 'email_template_edi_invoice',
          model: 'mail.template',
          res_id: 33,
        },
      ],
      'mail.template': [{ id: 33 }],
    },
  };
}

const customer: Customer = {
  sourceId: '7',
  kind: 'person',
  name: 'Line Kjær',
  email: 'line.kjaer@example.dk',
  phone: '+4512345678',
  vatNumber: null,
  address: { line1: 'Søndergade 12', postalCode: '8000', city: 'Aarhus C', country: 'DK' },
};

/** 2 × 400 kr. excl. VAT, 39,20 kr. shipping: 1.049,00 kr. incl. 25 % VAT. */
const order = (extra: Partial<Order> = {}): Order => ({
  sourceId: '1001',
  number: '1001',
  createdAt: '2026-10-24T10:00:00.000Z',
  paidAt: '2026-10-24T10:01:00.000Z',
  status: 'processing',
  currency: 'DKK',
  customer,
  lines: [
    {
      sku: 'E7-M',
      productId: '42',
      name: 'Lygtesæt',
      quantity: 2,
      unitPrice: 40000,
      vatRate: 0.25,
      category: null,
    },
  ],
  shipping: 3920,
  shippingVatRate: 0.25,
  shippingMethod: 'GLS',
  total: 104900,
  paymentMethod: { id: 'quickpay', title: 'Kort' },
  transactionId: 'qp-778',
  ...extra,
});

const FIELDS = {
  'order.externalId': 'woo_c1_order_1001',
  'order.clientRef': '1001',
  'order.origin': 'WooCommerce 1001',
  'partner.externalId': 'woo_c1_customer_7',
};

/** Route settings as the engine sends them: manifest defaults, then the route's own values. */
function opts(
  entity: 'order' | 'creditNote' | 'customer' | 'product',
  mode: WriteOptions['mode'],
  settings: Record<string, unknown> = {},
  extra: Partial<WriteOptions> = {},
): WriteOptions {
  const fields = odoo.routeSettings?.[entity] ?? [];
  const merged: Record<string, unknown> = {};
  for (const f of fields) merged[f.key] = settingValue(fields, settings, f.key);
  return {
    mode,
    fields: FIELDS,
    route: {
      settings: { ...merged, ...settings },
      mapping: { 'tax.domestic': '1', 'tax.vatFree': '3', 'tax.euB2b': '3', 'tax.export': '3' },
      tables: { paymentMethods: [{ from: 'quickpay', journal: '8' }] },
    },
    ...extra,
  };
}

const BASE_SETTINGS = {
  'shipping.productId': '21',
  'products.genericId': '20',
  'rounding.productId': '22',
};

function make(db = database()) {
  const fake = fakeOdoo(db);
  const adapter = openAdapter({
    connectorId: 'odoo',
    mode: 'live',
    credentials: CREDS,
    transport: fake.transport,
  });
  const did = (method: string) => fake.calls.filter((c) => c.modelMethod === method);
  return { adapter, db, calls: fake.calls, did };
}

describe('Odoo external ids', () => {
  it('keeps names Odoo accepts and finds the shop order again', () => {
    expect(xidName('woo_3f2a-91_order_1001')).toBe('woo_3f2a-91_order_1001');
    expect(xidName('woo_x_customer_guest:line@example.dk')).toBe(
      'woo_x_customer_guest_line_example_dk',
    );
    expect(parseOrderXid('woo_3f2a-91_order_1001')).toEqual({
      connectionId: '3f2a-91',
      sourceId: '1001',
    });
    expect(parseOrderXid('woo_3f2a-91_customer_7')).toBeNull();
  });

  it('picks the tax key per sale type like the account keys', () => {
    expect(taxKeys('domestic', 0.25, false, false)).toEqual(['tax.domestic']);
    expect(taxKeys('euB2b', 0, true, false)).toEqual(['tax.euB2bServices', 'tax.euB2b']);
    expect(taxKeys('euB2c', 0.25, false, false)).toEqual(['tax.euB2c', 'tax.domestic']);
    expect(taxKeys('euB2c', 0.19, false, true)).toEqual(['tax.euB2c']);
  });
});

describe('Odoo orders', () => {
  it('creates, confirms, invoices, posts and pays a paid order in Live', async () => {
    const { adapter, db, did } = make();
    const res = await adapter.write(
      'order',
      order(),
      opts('order', 'live', { ...BASE_SETTINGS, 'invoice.post': true }),
    );
    const so = db.tables['sale.order']![0]!;
    expect(res).toEqual({ action: 'create', destinationId: `sale.order,${so.id}` });
    expect(so).toMatchObject({
      partner_id: 8,
      client_order_ref: '1001',
      origin: 'WooCommerce 1001',
      state: 'sale',
      amount_total: 1049,
      fiscal_position_id: false,
    });
    const lines = db.tables['sale.order.line']!.filter((l) => l.parent === so.id);
    expect(lines.map((l) => [l.product_id, l.product_uom_qty, l.price_unit, l.tax_id])).toEqual([
      [10, 2, 400, [[6, 0, [1]]]],
      [21, 1, 39.2, [[6, 0, [1]]]],
    ]);
    // The external id is bound right after the create, through load.
    expect(db.tables['ir.model.data']!.find((x) => x.name === 'woo_c1_order_1001')).toMatchObject({
      module: '__agentor__',
      model: 'sale.order',
      res_id: so.id,
    });
    const inv = db.tables['account.move']![0]!;
    expect(inv).toMatchObject({
      state: 'posted',
      payment_state: 'paid',
      ref: '1001',
      invoice_date: '2026-10-24',
    });
    expect(db.tables['account.payment']![0]).toMatchObject({
      journal_id: 8,
      payment_date: '2026-10-24',
    });
    expect(did('action_confirm')).toHaveLength(1);
    expect(did('create_invoices')[0]!.kwargs.context).toMatchObject({ active_model: 'sale.order' });
    expect(did('action_create_payments')[0]!.kwargs.context).toMatchObject({
      active_model: 'account.move',
      active_ids: [inv.id],
    });
  });

  it('leaves a quotation and nothing more in Kladde', async () => {
    const { adapter, db, did } = make();
    await adapter.write('order', order(), opts('order', 'draft', BASE_SETTINGS));
    expect(db.tables['sale.order']![0]).toMatchObject({ state: 'draft' });
    expect(did('action_confirm')).toHaveLength(0);
    expect(db.tables['account.move']).toHaveLength(0);
  });

  it('writes nothing on a dry run', async () => {
    const { adapter, calls } = make();
    const res = await adapter.write('order', order(), opts('order', 'dry_run', BASE_SETTINGS));
    expect(res).toEqual({ action: 'create', destinationId: null });
    expect(calls.filter((c) => ['create', 'write', 'load'].includes(c.modelMethod ?? ''))).toEqual(
      [],
    );
  });

  it('updates the quotation when the order changes, and never a confirmed order', async () => {
    const { adapter, db } = make();
    await adapter.write('order', order(), opts('order', 'draft', BASE_SETTINGS));
    const changed = order({
      lines: [{ ...order().lines[0]!, quantity: 3 }],
      total: 154900,
    });
    const again = await adapter.write('order', changed, opts('order', 'draft', BASE_SETTINGS));
    expect(again.action).toBe('update');
    const so = db.tables['sale.order']![0]!;
    expect(db.tables['sale.order']).toHaveLength(1);
    expect(so.amount_total).toBe(1549);
    so.state = 'sale';
    const booked = await adapter.write(
      'order',
      order({ total: 204900, lines: [{ ...order().lines[0]!, quantity: 4 }] }),
      opts('order', 'live', { ...BASE_SETTINGS, 'order.invoiceWhen': 'never' }),
    );
    expect(booked.warnings).toEqual([{ code: 'CHANGED_AFTER_BOOKING', params: { order: '1001' } }]);
    expect(so.amount_total).toBe(1549);
  });

  it('sends prices incl. VAT when the chosen tax includes it', async () => {
    const { adapter, db } = make();
    const o = opts('order', 'draft', BASE_SETTINGS);
    o.route!.mapping['tax.domestic'] = '2';
    await adapter.write('order', order(), o);
    const lines = db.tables['sale.order.line']!;
    expect(lines.map((l) => l.price_unit)).toEqual([500, 49]);
    expect(db.tables['sale.order']![0]!.amount_total).toBe(1049);
  });

  it('adds a rounding line for øre and fails above the limit', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'order',
      order({ total: 104902 }),
      opts('order', 'draft', BASE_SETTINGS),
    );
    expect(res.warnings).toEqual([
      { code: 'TOTAL_ROUNDED', params: { diff: '0.02', odoo: '1049', shop: '1049.02' } },
    ]);
    expect(db.tables['sale.order.line']!.at(-1)).toMatchObject({
      product_id: 22,
      price_unit: 0.02,
    });
    const far = make();
    await expect(
      far.adapter.write('order', order({ total: 110000 }), opts('order', 'draft', BASE_SETTINGS)),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('warns when Odoo’s tax differs from what the shop charged', async () => {
    const { adapter } = make();
    const de = order({
      customer: { ...customer, address: { ...customer.address, country: 'DE' } },
      lines: [{ ...order().lines[0]!, vatRate: 0.19 }],
      shipping: 0,
      total: 95200,
    });
    const o = opts('order', 'draft', {
      ...BASE_SETTINGS,
      'oss.mode': 'destinationVat',
      'rounding.policy': 'ignoreBelow',
      'rounding.maxDiff': 100,
    });
    o.route!.mapping['tax.euB2c'] = '1';
    const res = await adapter.write('order', de, o);
    expect(res.warnings?.[0]).toEqual({
      code: 'VAT_RATE_MISMATCH',
      params: { line: 'Lygtesæt', shop: '19', odoo: '25' },
    });
  });

  it('refuses VAT it has no Odoo tax for', async () => {
    const { adapter } = make();
    const o = opts('order', 'draft', BASE_SETTINGS);
    delete o.route!.mapping['tax.domestic'];
    await expect(adapter.write('order', order(), o)).rejects.toBeInstanceOf(WriteError);
  });

  it('leaves taxes to Odoo with the odoo strategy and a fiscal position per sale type', async () => {
    const { adapter, db } = make();
    const o = opts('order', 'draft', {
      ...BASE_SETTINGS,
      'tax.strategy': 'odoo',
      'rounding.policy': 'ignoreBelow',
      'rounding.maxDiff': 1000,
    });
    o.route!.mapping['fiscal.domestic'] = '4';
    await adapter.write('order', order(), o);
    expect(db.tables['sale.order']![0]!.fiscal_position_id).toBe(4);
    expect(db.tables['sale.order.line']![0]!.tax_id).toBeUndefined();
  });

  it('uses the standard product for lines without a match, or stops when told to', async () => {
    const { adapter, db } = make();
    const unknown = order({ lines: [{ ...order().lines[0]!, sku: 'NYHED' }] });
    await adapter.write('order', unknown, opts('order', 'draft', BASE_SETTINGS));
    expect(db.tables['sale.order.line']![0]!.product_id).toBe(20);
    await expect(
      make().adapter.write(
        'order',
        unknown,
        opts('order', 'draft', { ...BASE_SETTINGS, 'products.missing': 'fail' }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('NYHED') });
  });

  it('books a direct invoice when the route says so', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'order',
      order(),
      opts('order', 'live', { ...BASE_SETTINGS, 'posting.type': 'invoice', 'invoice.post': true }),
    );
    const inv = db.tables['account.move']![0]!;
    expect(res.destinationId).toBe(`account.move,${inv.id}`);
    expect(inv).toMatchObject({
      move_type: 'out_invoice',
      state: 'posted',
      payment_state: 'paid',
      amount_total: 1049,
    });
    expect(db.tables['sale.order']).toHaveLength(0);
  });

  it('cancels the quotation when the shop cancels the order', async () => {
    const { adapter, db, did } = make();
    await adapter.write('order', order(), opts('order', 'draft', BASE_SETTINGS));
    const res = await adapter.write(
      'order',
      order({ status: 'cancelled' }),
      opts('order', 'live', BASE_SETTINGS),
    );
    expect(res.action).toBe('update');
    expect(db.tables['sale.order']![0]!.state).toBe('cancel');
    expect(did('action_cancel')[0]!.kwargs.context).toMatchObject({ disable_cancel_warning: true });
  });

  it('creates nothing for an order that was cancelled before it reached Odoo', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'order',
      order({ status: 'cancelled' }),
      opts('order', 'live', BASE_SETTINGS),
    );
    expect(res).toEqual({ action: 'skip', destinationId: null });
    expect(db.tables['sale.order']).toHaveLength(0);
  });

  it('warns instead of paying when no journal is known for the payment method', async () => {
    const { adapter } = make();
    const o = opts('order', 'live', { ...BASE_SETTINGS, 'invoice.post': true });
    o.route!.tables = {};
    const res = await adapter.write('order', order(), o);
    expect(res.warnings).toEqual([
      { code: 'PAYMENT_NOT_REGISTERED', params: { method: 'quickpay' } },
    ]);
  });
});

describe('Odoo credit notes', () => {
  const refund: CreditNote = {
    sourceId: '901',
    number: '901',
    orderSourceId: '1001',
    createdAt: '2026-10-25T09:00:00.000Z',
    currency: 'DKK',
    customer,
    lines: [
      {
        sku: 'E7-M',
        productId: '42',
        name: 'Lygtesæt',
        quantity: 1,
        unitPrice: 40000,
        vatRate: 0.25,
        category: null,
      },
    ],
    total: 50000,
    reason: 'Fortrudt',
    refundsPayment: true,
    meta: { orderNumber: '1001', paymentMethod: 'quickpay' },
  };
  const cnFields = {
    'creditNote.externalId': 'woo_c1_refund_901',
    'creditNote.orderExternalId': 'woo_c1_order_1001',
  };

  it('credits the posted invoice with the refunded lines', async () => {
    const { adapter, db } = make();
    await adapter.write(
      'order',
      order(),
      opts('order', 'live', { ...BASE_SETTINGS, 'invoice.post': true }),
    );
    const inv = db.tables['account.move']![0]!;
    const res = await adapter.write(
      'creditNote',
      refund,
      opts(
        'creditNote',
        'live',
        { ...BASE_SETTINGS, 'creditNote.post': true, 'creditNote.registerRefund': true },
        { fields: cnFields },
      ),
    );
    const cn = db.tables['account.move']!.find((m) => m.move_type === 'out_refund')!;
    expect(res).toEqual({ action: 'create', destinationId: `account.move,${cn.id}` });
    expect(cn).toMatchObject({
      reversed_entry_id: inv.id,
      state: 'posted',
      amount_total: 500,
      payment_state: 'paid',
    });
    // A repeat finds it by its external id.
    const again = await adapter.write(
      'creditNote',
      refund,
      opts('creditNote', 'live', BASE_SETTINGS, { fields: cnFields }),
    );
    expect(again.action).toBe('skip');
  });

  it('waits while the order is not invoiced yet', async () => {
    const { adapter } = make();
    await adapter.write('order', order(), opts('order', 'draft', BASE_SETTINGS));
    const err = await adapter
      .write('creditNote', refund, opts('creditNote', 'live', BASE_SETTINGS, { fields: cnFields }))
      .catch((e) => e);
    expect(err).toMatchObject({ kind: 'transient', retryAfterMs: 3_600_000 });
  });

  it('reverses the whole invoice on a full refund when chosen', async () => {
    const { adapter, db, did } = make();
    await adapter.write(
      'order',
      order(),
      opts('order', 'live', { ...BASE_SETTINGS, 'invoice.post': true }),
    );
    await adapter.write(
      'creditNote',
      { ...refund, total: 104900 },
      opts(
        'creditNote',
        'draft',
        { ...BASE_SETTINGS, 'creditNote.mode': 'reversal' },
        { fields: cnFields },
      ),
    );
    expect(did('reverse_moves')).toHaveLength(1);
    expect(db.tables['account.move']!.find((m) => m.move_type === 'out_refund')!.amount_total).toBe(
      1049,
    );
  });
});

describe('Odoo contacts and products', () => {
  it('updates the contact it finds by e-mail and binds its external id', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'customer',
      customer,
      opts('customer', 'live', {}, { fields: { 'partner.externalId': 'woo_c1_customer_7' } }),
    );
    expect(res).toEqual({ action: 'update', destinationId: '8' });
    expect(db.tables['res.partner']![0]).toMatchObject({ city: 'Aarhus C', country_id: 59 });
    expect(db.tables['res.partner']![0]!.vat).toBeUndefined();
    expect(
      db.tables['ir.model.data']!.some((x) => x.name === 'woo_c1_customer_7' && x.res_id === 8),
    ).toBe(true);
  });

  it('creates a new contact as a customer', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'customer',
      {
        ...customer,
        sourceId: '8',
        email: 'ny@example.dk',
        kind: 'company',
        companyName: 'Cykelhuset ApS',
        vatNumber: 'DK12345678',
      },
      opts('customer', 'live'),
    );
    expect(res.action).toBe('create');
    expect(db.tables['res.partner']!.at(-1)).toMatchObject({
      name: 'Cykelhuset ApS',
      is_company: true,
      vat: 'DK12345678',
      customer_rank: 1,
    });
  });

  it('matches products on SKU and updates them', async () => {
    const { adapter, db } = make();
    const res = await adapter.write(
      'product',
      {
        sourceId: '42',
        sku: 'E7-M',
        name: 'Lygtesæt',
        category: null,
        price: 40000,
        vatRate: 0.25,
      },
      opts('product', 'live'),
    );
    expect(res).toEqual({ action: 'update', destinationId: '10' });
    expect(db.tables['product.product']![0]).toMatchObject({ name: 'Lygtesæt', list_price: 400 });
  });
});

describe('Odoo source links', () => {
  it('tells deliveries and invoices which shop order they came from', async () => {
    const { adapter, db } = make();
    await adapter.write(
      'order',
      order(),
      opts('order', 'live', { ...BASE_SETTINGS, 'invoice.post': true }),
    );
    const so = db.tables['sale.order']![0]!;
    db.tables['stock.picking'] = [
      {
        id: 600,
        name: 'WH/OUT/1',
        state: 'done',
        picking_type_code: 'outgoing',
        sale_id: [so.id, so.name],
        write_date: '2026-10-25 08:00:00',
      },
    ];
    db.tables['stock.move'] = [];
    db.fields = {
      'stock.picking': {
        name: { type: 'char' },
        sale_id: { type: 'many2one' },
        write_date: { type: 'datetime' },
      },
      'account.move': {},
    };
    const [shipment] = await adapter.fetch('shipment', { limit: 5 });
    expect(shipment!.orderSource).toEqual({ connectionId: 'c1', sourceId: '1001' });
    const [status] = await adapter.fetch('invoiceStatus', { limit: 5 });
    expect(status!.orderSource).toEqual({ connectionId: 'c1', sourceId: '1001' });
  });
});
