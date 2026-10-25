import { describe, expect, it } from 'vitest';
import { catalogueFromFields, odoo, WriteError } from '../src/index.js';
import {
  odooError,
  odooMajor,
  odooTime,
  openAdapter,
  OdooAdapter,
  toOdooTime,
} from '../src/live/index.js';
import { adapterContract } from './contract.js';
import { fakeOdoo, type FakeOdooDb } from './fake-odoo.js';

/** Odoo 16 live client against a recorded database (PLAN-INTEGRATIONS-WOO-ODOO16 P1). */

const BASE = 'https://odoo.nordlys.example';
const CREDS = {
  baseUrl: BASE,
  database: 'nordlys',
  login: 'agentor@nordlys.example',
  apiKey: 'key-ok',
};

const product = (id: number, sku: string, free: number, extra: Record<string, unknown> = {}) => ({
  id,
  default_code: sku,
  barcode: `57000000000${id}`,
  display_name: `[${sku}] Vare ${id}`,
  free_qty: free,
  qty_available: free + 2,
  virtual_available: free + 5,
  detailed_type: 'product',
  ...extra,
});

const quant = (id: number, productId: number, at: string) => ({
  id,
  product_id: [productId, `Vare ${productId}`],
  'location_id.usage': 'internal',
  write_date: at,
});

function database(): FakeOdooDb {
  return {
    tables: {
      'res.users': [{ id: 2, company_id: [1, 'Nordlys Cykler ApS'], company_ids: [1, 3] }],
      'res.company': [
        { id: 1, name: 'Nordlys Cykler ApS' },
        { id: 3, name: 'Nordlys Udlejning ApS' },
      ],
      'product.product': [
        product(10, 'E7-M', 4),
        product(11, 'HJELM-L', 0.6),
        product(12, 'SERVICE', 0, { detailed_type: 'service' }),
      ],
      'stock.quant': [
        quant(1, 10, '2026-10-24 08:00:00'),
        quant(2, 11, '2026-10-24 09:30:00'),
        quant(3, 12, '2026-10-24 07:00:00'),
      ],
      'stock.move': [
        {
          id: 70,
          product_id: [10, 'Vare 10'],
          picking_id: [500, 'WH/OUT/00042'],
          name: 'Elcykel Nordlys E7',
          state: 'done',
          quantity_done: 1,
          write_date: '2026-10-24 10:00:00',
        },
      ],
      'stock.picking': [
        {
          id: 500,
          name: 'WH/OUT/00042',
          origin: 'S00031',
          state: 'done',
          picking_type_code: 'outgoing',
          date_done: '2026-10-24 10:00:00',
          write_date: '2026-10-24 10:00:05',
          sale_id: [31, 'S00031'],
          carrier_id: [4, 'GLS'],
          carrier_tracking_ref: '00340434161094042557',
          carrier_tracking_url: false,
          x_studio_channel: [2, 'Webshop'],
        },
        {
          id: 501,
          name: 'WH/IN/00007',
          state: 'done',
          picking_type_code: 'incoming',
          write_date: '2026-10-24 11:00:00',
        },
      ],
      'sale.order': [{ id: 31, client_order_ref: '10447' }],
      'account.move': [
        {
          id: 900,
          name: 'INV/2026/00123',
          move_type: 'out_invoice',
          state: 'posted',
          payment_state: 'paid',
          currency_id: [12, 'DKK'],
          amount_total: 17169.5,
          amount_residual: 0,
          invoice_date: '2026-10-24',
          invoice_date_due: '2026-10-24',
          ref: '10447',
          invoice_origin: 'S00031',
          write_date: '2026-10-24 12:00:00',
        },
        {
          id: 901,
          name: '/',
          move_type: 'out_refund',
          state: 'draft',
          payment_state: 'not_paid',
          currency_id: [12, 'DKK'],
          amount_total: 500,
          amount_residual: 500,
          invoice_date: false,
          invoice_date_due: false,
          ref: false,
          invoice_origin: 'S00031',
          write_date: '2026-10-24 12:30:00',
        },
        { id: 902, name: 'BILL/1', move_type: 'in_invoice', write_date: '2026-10-24 13:00:00' },
      ],
      'account.tax': [
        {
          id: 1,
          name: '25% moms',
          amount: 25,
          amount_type: 'percent',
          price_include: false,
          type_tax_use: 'sale',
        },
        {
          id: 2,
          name: '25% moms inkl.',
          amount: 25,
          amount_type: 'percent',
          price_include: true,
          type_tax_use: 'sale',
        },
      ],
      'ir.module.module': [
        { id: 1, name: 'sale', shortdesc: 'Sales', latest_version: '16.0.1.2', state: 'installed' },
        {
          id: 2,
          name: 'l10n_dk',
          shortdesc: 'Denmark - Accounting',
          latest_version: '16.0.1.0',
          state: 'installed',
        },
        {
          id: 3,
          name: 'delivery',
          shortdesc: 'Delivery Costs',
          latest_version: '16.0.1.0',
          state: 'uninstalled',
        },
      ],
      'res.partner': [
        { id: 7, display_name: 'Webshopkunde' },
        { id: 8, display_name: 'Line Kjær' },
      ],
    },
    fields: {
      'stock.picking': Object.fromEntries(
        [
          ['name', 'char'],
          ['origin', 'char'],
          ['state', 'selection'],
          ['date_done', 'datetime'],
          ['write_date', 'datetime'],
          ['sale_id', 'many2one'],
          ['carrier_id', 'many2one'],
          ['carrier_tracking_ref', 'char'],
          ['carrier_tracking_url', 'char'],
          ['x_studio_channel', 'many2one'],
          ['x_studio_files', 'many2many'],
        ].map(([n, type]) => [n, { type, string: n, store: n !== 'carrier_tracking_url' }]),
      ),
      'account.move': Object.fromEntries(
        [
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
        ].map((n) => [n, { type: 'char', string: n, store: true }]),
      ),
    },
  };
}

function make(db = database(), settings: Record<string, unknown> = {}, creds = CREDS) {
  const fake = fakeOdoo(db);
  const adapter = openAdapter({
    connectorId: 'odoo',
    mode: 'live',
    credentials: creds,
    settings,
    transport: fake.transport,
  });
  return { adapter, calls: fake.calls };
}

describe('Odoo values', () => {
  it('reads Odoo times as UTC and writes domain times back', () => {
    expect(odooTime('2026-10-25 12:00:00')).toBe('2026-10-25T12:00:00.000Z');
    expect(odooTime('2026-10-25')).toBe('2026-10-25T00:00:00.000Z');
    expect(odooTime(false)).toBeNull();
    expect(toOdooTime('2026-10-25T13:00:00.000+01:00')).toBe('2026-10-25 12:00:00');
  });

  it('finds the major version in every server_version form', () => {
    expect(odooMajor('16.0+e')).toBe(16);
    expect(odooMajor('saas~16.3+e')).toBe(16);
    expect(odooMajor('17.0-20251010')).toBe(17);
    expect(odooMajor('nightly')).toBeNull();
  });

  it('maps Odoo exceptions to the engine classes', () => {
    const kind = (name: string, message = 'x') => odooError({ data: { name, message } }).kind;
    expect(kind('odoo.exceptions.AccessDenied')).toBe('unauthorized');
    expect(kind('odoo.exceptions.AccessError')).toBe('unauthorized');
    expect(kind('odoo.exceptions.UserError')).toBe('invalid');
    expect(kind('odoo.exceptions.ValidationError')).toBe('invalid');
    expect(kind('psycopg2.errors.SerializationFailure', 'could not serialize access')).toBe(
      'transient',
    );
  });
});

describe('Odoo connection test', () => {
  it('signs in with the API key and names the company', async () => {
    const { adapter, calls } = make();
    const res = await adapter.test();
    expect(res).toEqual({
      ok: true,
      account: { id: 'odoo.nordlys.example/nordlys', name: 'Nordlys Cykler ApS' },
    });
    // Every model call carries database, uid and key in execute_kw, never in the URL.
    const call = calls.find((c) => c.modelMethod === 'read')!;
    expect(call.service).toBe('object');
    expect(calls.map((c) => c.method)).toContain('authenticate');
  });

  it('sends the chosen company on every call', async () => {
    const { adapter, calls } = make(database(), { companyId: '3' });
    expect((await adapter.test()).ok).toBe(true);
    const objectCalls = calls.filter((c) => c.service === 'object');
    expect(objectCalls.length).toBeGreaterThan(0);
    for (const c of objectCalls)
      expect(c.kwargs.context).toMatchObject({ allowed_company_ids: [3] });
  });

  it('refuses a company the user has no access to', async () => {
    const res = await make(database(), { companyId: '9' }).adapter.test();
    expect(res).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('says so when the key is wrong', async () => {
    const res = await make(database(), {}, { ...CREDS, apiKey: 'wrong' }).adapter.test();
    expect(res).toEqual({
      ok: false,
      reason: 'unauthorized',
      message: 'Odoo afviste brugeren eller API-nøglen.',
    });
  });

  it('names a database that does not exist', async () => {
    const res = await make(database(), {}, { ...CREDS, database: 'nordly' }).adapter.test();
    expect(res).toEqual({
      ok: false,
      reason: 'unauthorized',
      message: 'Databasen "nordly" findes ikke på serveren.',
    });
  });

  it('turns down versions without a profile', async () => {
    const res = await make({ ...database(), version: '15.0+e' }).adapter.test();
    expect(res).toMatchObject({ ok: false, reason: 'unknown' });
    expect((res as { message: string }).message).toContain('Odoo 15.0+e');
  });

  it('lists the models the user may not read', async () => {
    const res = await make({
      ...database(),
      denied: ['stock.quant', 'account.move'],
    }).adapter.test();
    expect(res).toEqual({
      ok: false,
      reason: 'unauthorized',
      message: 'Brugeren mangler læseadgang i Odoo til: stock.quant, account.move.',
    });
  });

  it('explains an address that is not Odoo', async () => {
    const adapter = new OdooAdapter({
      connectorId: 'odoo',
      mode: 'live',
      credentials: CREDS,
      transport: async () => ({ status: 404, headers: {}, body: 'Not Found' }),
    });
    expect(await adapter.test()).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('wants all four credentials', () => {
    expect(
      () => new OdooAdapter({ connectorId: 'odoo', mode: 'live', credentials: { baseUrl: BASE } }),
    ).toThrow(WriteError);
  });
});

describe('Odoo lookups', () => {
  it('gives taxes with their rate and whether prices include VAT', async () => {
    expect(await make().adapter.lookup('taxes')).toEqual([
      {
        value: '1',
        label: '25% moms',
        meta: { amount: 25, amountType: 'percent', priceInclude: false },
      },
      {
        value: '2',
        label: '25% moms inkl.',
        meta: { amount: 25, amountType: 'percent', priceInclude: true },
      },
    ]);
  });

  it('lists the installed apps with the server version first', async () => {
    const apps = await make().adapter.lookup('apps');
    expect(apps.map((a) => a.value)).toEqual(['odoo', 'sale', 'l10n_dk']);
    expect(apps[0]).toMatchObject({ label: 'Odoo 16.0+e' });
  });

  it('answers any model by name search', async () => {
    expect(await make().adapter.lookup('relation:res.partner')).toEqual([
      { value: '7', label: 'Webshopkunde' },
      { value: '8', label: 'Line Kjær' },
    ]);
  });

  it('reads a model’s fields, which become variables and targets', async () => {
    const fields = await make().adapter.lookup('fields:stock.picking');
    const channel = fields.find((f) => f.value === 'x_studio_channel');
    expect(channel).toEqual({
      value: 'x_studio_channel',
      label: 'x_studio_channel',
      meta: { type: 'many2one', store: true },
    });
    const { variables, targets } = catalogueFromFields(
      fields,
      odoo.outputs[1]!.dynamicVariables![0]!,
    );
    expect(variables.map((v) => v.path)).toEqual(['shipment.fields.x_studio_channel']);
    expect(targets.map((t) => t.key)).toEqual(['shipment.fields.x_studio_channel']);
  });
});

describe('catalogueFromFields', () => {
  const fields = [
    { value: 'x_note', label: 'Note', meta: { type: 'char', size: 40, required: true } },
    { value: 'x_total', label: 'Beløb', meta: { type: 'monetary' } },
    { value: 'x_computed', label: 'Beregnet', meta: { type: 'char', store: false } },
    { value: 'x_tags', label: 'Mærker', meta: { type: 'many2many' } },
    { value: 'name', label: 'Navn', meta: { type: 'char' } },
    { value: 'message_ids', label: 'Beskeder', meta: { type: 'one2many' } },
  ];

  it('keeps the customer’s own fields by default', () => {
    const out = catalogueFromFields(fields, {
      model: 'sale.order',
      scope: 'record',
      prefix: 'order.fields',
    });
    expect(out.variables).toEqual([
      { path: 'order.fields.x_note', label: 'Note', type: 'string', scope: 'record' },
      { path: 'order.fields.x_total', label: 'Beløb', type: 'money', scope: 'record' },
      { path: 'order.fields.x_computed', label: 'Beregnet', type: 'string', scope: 'record' },
    ]);
    expect(out.targets).toEqual([
      {
        key: 'order.fields.x_note',
        label: 'Note',
        scope: 'record',
        required: true,
        maxLength: 40,
        editable: 'template',
      },
      {
        key: 'order.fields.x_total',
        label: 'Beløb',
        scope: 'record',
        required: false,
        editable: 'expression',
      },
    ]);
  });

  it('shows standard fields too in the developer view, never bookkeeping fields', () => {
    const out = catalogueFromFields(fields, {
      model: 'sale.order',
      scope: 'line',
      prefix: 'line.fields',
      include: 'all',
    });
    expect(out.variables.map((v) => v.path)).toContain('line.fields.name');
    expect(out.variables.map((v) => v.path)).not.toContain('line.fields.message_ids');
    expect(out.variables.every((v) => v.scope === 'line')).toBe(true);
  });
});

describe('Odoo stock', () => {
  it('reads free quantities of storable products in change order', async () => {
    const { adapter, calls } = make(database(), {
      'stock.warehouseId': '1',
      'stock.safetyBuffer': 0,
    });
    const stock = await adapter.fetch('stock', { limit: 50 });
    expect(stock.map(({ raw: _raw, ...s }) => s)).toEqual([
      { sourceId: '11', sku: 'HJELM-L', quantity: 0, updatedAt: '2026-10-24T09:30:00.000Z' },
      { sourceId: '10', sku: 'E7-M', quantity: 4, updatedAt: '2026-10-24T10:00:00.000Z' },
    ]);
    const read = calls.find((c) => c.model === 'product.product' && c.modelMethod === 'read')!;
    expect(read.kwargs.context).toMatchObject({ warehouse: 1 });
  });

  it('applies the safety buffer, the barcode match and the chosen quantity', async () => {
    const stock = await make(database(), {
      'stock.safetyBuffer': 1,
      'stock.match': 'barcode',
      'stock.quantity': 'qty_available',
    }).adapter.fetch('stock', { limit: 50 });
    expect(stock.find((s) => s.sourceId === '10')).toMatchObject({
      sku: '5700000000010',
      quantity: 5,
    });
  });

  it('asks only for changes since the cursor', async () => {
    const { adapter, calls } = make();
    const stock = await adapter.fetch('stock', { limit: 50, since: '2026-10-24T09:00:00.000Z' });
    expect(stock.map((s) => s.sourceId)).toEqual(['11', '10']);
    const q = calls.find((c) => c.model === 'stock.quant')!;
    expect(q.args[0]).toContainEqual(['write_date', '>=', '2026-10-24 09:00:00']);
  });

  it('never moves the cursor past a change it did not read', async () => {
    const db = database();
    // Ten quant changes fill the batch (10); the move after the cut must wait for the next poll.
    db.tables['stock.quant'] = Array.from({ length: 10 }, (_, i) =>
      quant(i + 1, 10, `2026-10-24 08:0${i}:00`),
    );
    db.tables['stock.move'] = [
      { id: 71, product_id: [11, 'Vare 11'], state: 'done', write_date: '2026-10-24 08:30:00' },
    ];
    const stock = await make(db, { batchSize: 10 }).adapter.fetch('stock', { limit: 5 });
    expect(stock.map((s) => s.sourceId)).toEqual(['10']);
    expect(stock[0]!.updatedAt).toBe('2026-10-24T08:09:00.000Z');
  });
});

describe('Odoo deliveries and invoice status', () => {
  it('reads done deliveries with lines, tracking and the shop’s order number', async () => {
    const [s, ...rest] = await make().adapter.fetch('shipment', { limit: 10 });
    expect(rest).toEqual([]);
    const { raw: _raw, ...shipment } = s!;
    expect(shipment).toEqual({
      sourceId: '500',
      number: 'WH/OUT/00042',
      orderRef: '10447',
      state: 'done',
      doneAt: '2026-10-24T10:00:00.000Z',
      carrier: 'GLS',
      trackingRef: '00340434161094042557',
      trackingUrl: null,
      lines: [{ sku: 'E7-M', name: 'Elcykel Nordlys E7', quantity: 1 }],
      updatedAt: '2026-10-24T10:00:05.000Z',
      fields: { x_studio_channel: 'Webshop' },
    });
  });

  it('reads customer invoices and credit notes, not bills', async () => {
    const statuses = await make().adapter.fetch('invoiceStatus', { limit: 10 });
    expect(statuses.map(({ raw: _raw, ...s }) => s)).toEqual([
      {
        sourceId: '900',
        kind: 'invoice',
        number: 'INV/2026/00123',
        orderRef: '10447',
        state: 'posted',
        paymentState: 'paid',
        currency: 'DKK',
        total: 1716950,
        residual: 0,
        date: '2026-10-24',
        dueDate: '2026-10-24',
        updatedAt: '2026-10-24T12:00:00.000Z',
        fields: {},
      },
      {
        sourceId: '901',
        kind: 'creditNote',
        number: null,
        orderRef: 'S00031',
        state: 'draft',
        paymentState: 'notPaid',
        currency: 'DKK',
        total: 50000,
        residual: 50000,
        date: null,
        dueDate: null,
        updatedAt: '2026-10-24T12:30:00.000Z',
        fields: {},
      },
    ]);
  });

  it('counts what it can read', async () => {
    const { adapter } = make();
    expect(await adapter.count!('invoiceStatus')).toBe(2);
    expect(await adapter.count!('shipment')).toBe(1);
    expect(await adapter.count!('stock')).toBe(2);
    expect(await adapter.count!('order')).toBeNull();
  });

  it('reports a rejected read as a typed error', async () => {
    const db = database();
    db.errors = {
      'account.move.search_read': {
        name: 'psycopg2.errors.SerializationFailure',
        message: 'could not serialize access due to concurrent update',
      },
    };
    const err = await make(db)
      .adapter.fetch('invoiceStatus', { limit: 1 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect((err as WriteError).kind).toBe('transient');
  });

  it('does not write yet', async () => {
    await expect(
      make().adapter.write('stock', { sourceId: '1', sku: null, quantity: 1 }, { mode: 'live' }),
    ).rejects.toBeInstanceOf(WriteError);
  });
});

adapterContract('Odoo (recorded)', odoo, () => make().adapter);
