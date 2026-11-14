import { describe, expect, it } from 'vitest';
import {
  saleKind,
  woocommerce,
  type CreditNote,
  type InvoiceStatus,
  type Order,
  type Shipment,
} from '../src/index.js';
import { openAdapter, WooAdapter, type WooOrder } from '../src/live/index.js';
import { adapterContract } from './contract.js';
import { fakeTransport, type FakeRoute } from './fake-http.js';

/** WooCommerce live client against a recorded shop (PLAN-INTEGRATIONS-WOO-DINERO P1). */

const BASE = 'https://nordlys-cykler.example';
const HOOK = 'https://ingest.agentor.example/hooks/tok123';

const tax = (total: string) => [{ id: 1, total, subtotal: total }];

const DK_ORDER: WooOrder = {
  id: 1001,
  number: '1001',
  status: 'processing',
  currency: 'DKK',
  prices_include_tax: true,
  date_created_gmt: '2026-10-18T10:00:00',
  date_modified_gmt: '2026-10-18T10:05:00',
  date_paid_gmt: '2026-10-18T10:01:00',
  customer_id: 7,
  customer_note: 'Ring på døren',
  billing: {
    first_name: 'Line',
    last_name: 'Kjær',
    address_1: 'Søndergade 12',
    city: 'Aarhus C',
    postcode: '8000',
    country: 'DK',
    email: 'Line.Kjaer@example.dk',
    phone: '+4512345678',
  },
  shipping: { first_name: 'Line', last_name: 'Kjær', address_1: 'Søndergade 12', country: 'DK' },
  payment_method: 'quickpay',
  payment_method_title: 'Kort',
  transaction_id: 'qp-778',
  total: '17169.50',
  meta_data: [
    { key: '_wc_order_attribution_source_type', value: 'organic' },
    { key: '_billing_ean', value: '5798000000001' },
  ],
  line_items: [
    {
      id: 11,
      name: 'Elcykel Nordlys E7',
      product_id: 42,
      variation_id: 0,
      quantity: 1,
      subtotal: '15196.00',
      subtotal_tax: '3799.00',
      total: '13676.40',
      total_tax: '3419.10',
      taxes: tax('3419.1'),
      sku: 'E7-M',
      meta_data: [],
    },
  ],
  tax_lines: [
    {
      id: 41,
      rate_code: 'DK-MOMS-1',
      rate_id: 1,
      label: 'Moms',
      tax_total: '3424.10',
      shipping_tax_total: '9.80',
      rate_percent: 25,
    },
  ],
  shipping_lines: [
    { id: 21, method_title: 'GLS Pakkeshop', total: '39.20', total_tax: '9.80', taxes: tax('9.8') },
  ],
  fee_lines: [{ id: 31, name: 'Gebyr', total: '20.00', total_tax: '5.00', taxes: tax('5') }],
  coupon_lines: [{ code: 'host10' }],
  refunds: [
    { id: 901, total: '-500.00' },
    { id: 902, total: '-17095.50' },
  ],
};

const DE_ORDER: WooOrder = {
  id: 1002,
  number: 'WEB-1002',
  status: 'on-hold',
  currency: 'EUR',
  date_created_gmt: '2026-10-18T11:00:00',
  date_modified_gmt: '2026-10-18T11:00:00',
  customer_id: 0,
  billing: {
    first_name: 'Hans',
    last_name: 'Weber',
    company: 'Hans Weber GmbH',
    address_1: 'Radweg 4',
    city: 'Hamburg',
    postcode: '20095',
    country: 'DE',
    email: 'einkauf@weber.example',
  },
  shipping: {},
  total: '600.00',
  meta_data: [{ key: '_billing_vat_number', value: 'DE811000001' }],
  line_items: [
    {
      id: 12,
      name: 'Cykelsæt',
      product_id: 60,
      variation_id: 0,
      quantity: 1,
      subtotal: '600.00',
      total: '600.00',
      total_tax: '0.00',
      taxes: [],
      sku: 'SET-1',
      meta_data: [{ key: '_bundled_items', value: ['x'] }],
    },
    {
      id: 13,
      name: 'Hjelm i sæt',
      product_id: 61,
      variation_id: 0,
      quantity: 1,
      subtotal: '0.00',
      total: '0.00',
      total_tax: '0.00',
      taxes: [],
      sku: 'HELM-SET',
      meta_data: [{ key: '_bundled_by', value: 'abc' }],
    },
  ],
  tax_lines: [],
  shipping_lines: [],
  refunds: [],
};

const REFUND_AMOUNT = {
  id: 901,
  date_created_gmt: '2026-10-19T09:00:00',
  amount: '500.00',
  reason: 'Ridse i lakken',
  refunded_payment: true,
  line_items: [],
};
const REFUND_LINES = {
  id: 902,
  date_created_gmt: '2026-10-20T09:00:00',
  amount: '17095.50',
  reason: '',
  refunded_payment: false,
  line_items: [
    {
      id: 51,
      name: 'Elcykel Nordlys E7',
      product_id: 42,
      variation_id: 0,
      quantity: -1,
      subtotal: '-13676.40',
      total: '-13676.40',
      total_tax: '-3419.10',
      taxes: tax('-3419.1'),
      sku: 'E7-M',
    },
  ],
};

const PRODUCTS = [
  {
    id: 42,
    name: 'Elcykel Nordlys E7',
    sku: 'E7-M',
    regular_price: '15196.00',
    categories: [{ id: 3, name: 'Cykler' }],
    date_modified_gmt: '2026-10-01T08:00:00',
  },
  {
    id: 60,
    name: 'Cykelsæt',
    sku: 'SET-1',
    regular_price: '600.00',
    tax_status: 'none',
    categories: [{ id: 4, name: 'Sæt' }],
  },
  { id: 51, parent_id: 50, name: 'Cykelhjelm Pro - M', sku: 'HELM-PRO-M', categories: [] },
];

const CUSTOMER = {
  id: 7,
  email: 'line.kjaer@example.dk',
  first_name: 'Line',
  last_name: 'Kjær',
  billing: { country: 'DK' },
  shipping: {},
  date_created_gmt: '2026-01-01T00:00:00',
  date_modified_gmt: '2026-10-10T00:00:00',
};

interface Hook {
  id: number;
  name: string;
  topic: string;
  status: string;
  delivery_url: string;
}

function shop(opts: { hooks?: Hook[]; stripAuth?: boolean; refunds?: unknown[] } = {}) {
  const hooks = opts.hooks ?? [];
  const list = (items: unknown[], url: URL) => {
    const per = Number(url.searchParams.get('per_page') ?? '10');
    return {
      json: items.slice(0, per),
      headers: {
        'x-wp-total': String(items.length),
        'x-wp-totalpages': String(Math.ceil(items.length / per) || 1),
      },
    };
  };
  const routes: FakeRoute[] = [
    {
      method: 'GET',
      path: /\/orders$/,
      reply: (_m, url, req) =>
        opts.stripAuth && !url.searchParams.get('consumer_key') && req.headers?.authorization
          ? {
              status: 401,
              json: {
                code: 'woocommerce_rest_authentication_error',
                message: 'Consumer key is missing.',
              },
            }
          : list([DK_ORDER, DE_ORDER], url),
    },
    {
      method: 'GET',
      path: /\/orders\/(\d+)\/refunds$/,
      reply: () => ({ json: opts.refunds ?? [REFUND_AMOUNT, REFUND_LINES] }),
    },
    {
      method: 'GET',
      path: /\/orders\/(\d+)\/refunds\/(\d+)$/,
      reply: (m) => {
        const r = [REFUND_AMOUNT, REFUND_LINES].find((x) => String(x.id) === m[2]);
        return r ? { json: r } : { status: 404, json: {} };
      },
    },
    {
      method: 'POST',
      path: /\/orders\/(\d+)\/refunds$/,
      reply: () => ({ status: 201, json: { id: 950 } }),
    },
    {
      method: 'GET',
      path: /\/orders\/(\d+)$/,
      reply: (m) => {
        const o = [DK_ORDER, DE_ORDER].find((x) => String(x.id) === m[1]);
        return o
          ? { json: o }
          : { status: 404, json: { code: 'woocommerce_rest_shop_order_invalid_id' } };
      },
    },
    {
      method: 'GET',
      path: /\/refunds$/,
      reply: (_m, url) => ({
        json: url.searchParams.get('include') === '901' ? [{ id: 901, parent_id: 1001 }] : [],
      }),
    },
    {
      method: 'GET',
      path: /\/products$/,
      reply: (_m, url) => {
        const include = url.searchParams.get('include')?.split(',');
        const sku = url.searchParams.get('sku');
        const items = PRODUCTS.filter(
          (p) => (!include || include.includes(String(p.id))) && (!sku || p.sku === sku),
        );
        return list(items, url);
      },
    },
    {
      method: 'GET',
      path: /\/products\/(\d+)$/,
      reply: (m) => {
        const p = PRODUCTS.find((x) => String(x.id) === m[1]);
        return p ? { json: p } : { status: 404, json: {} };
      },
    },
    { method: 'PUT', path: /\/products\/.+$/, reply: () => ({ json: { id: 1 } }) },
    { method: 'GET', path: /\/customers\/7$/, reply: () => ({ json: CUSTOMER }) },
    { method: 'GET', path: /\/customers$/, reply: (_m, url) => list([CUSTOMER], url) },
    { method: 'GET', path: /\/webhooks$/, reply: (_m, url) => list(hooks, url) },
    { method: 'POST', path: /\/webhooks$/, reply: () => ({ status: 201, json: { id: 99 } }) },
    { method: 'PUT', path: /\/webhooks\/(\d+)$/, reply: () => ({ json: {} }) },
    { method: 'DELETE', path: /\/webhooks\/(\d+)$/, reply: () => ({ json: {} }) },
    {
      method: 'GET',
      path: /\/reports\/orders\/totals$/,
      reply: () => ({
        json: [
          { slug: 'processing', name: 'Behandles', total: 3 },
          { slug: 'awaiting-shipment', name: 'Afventer forsendelse', total: 1 },
        ],
      }),
    },
    {
      method: 'GET',
      path: /\/payment_gateways$/,
      reply: () => ({
        json: [
          { id: 'quickpay', title: 'Kort', enabled: true },
          { id: 'cod', title: 'Efterkrav', enabled: false },
        ],
      }),
    },
  ];
  return fakeTransport(routes);
}

function adapter(
  t = shop(),
  extra: Record<string, string> = {},
  persisted: Record<string, string>[] = [],
) {
  return new WooAdapter({
    connectorId: 'woocommerce',
    mode: 'live',
    connectionId: 'c0ffee00-1111-2222-3333-444455556666',
    credentials: { baseUrl: BASE, consumerKey: 'ck_test', consumerSecret: 'cs_test', ...extra },
    settings: { 'meta.ean': '_billing_ean' },
    persist: async (p) => void persisted.push(p),
    transport: t.transport,
  });
}

describe('normalising orders', () => {
  it('turns a Danish order into the common model', async () => {
    const [o] = (await adapter().fetch('order', { limit: 1 })) as Order[];
    expect(o).toMatchObject({
      sourceId: '1001',
      number: '1001',
      status: 'processing',
      sourceStatus: 'processing',
      currency: 'DKK',
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:05:00.000Z',
      paidAt: '2026-10-18T10:01:00.000Z',
      total: 1716950,
      shipping: 3920,
      shippingVatRate: 0.25,
      shippingMethod: 'GLS Pakkeshop',
      paymentMethod: { id: 'quickpay', title: 'Kort' },
      transactionId: 'qp-778',
      couponCodes: ['host10'],
      note: 'Ring på døren',
      meta: { ean: '5798000000001' },
      customer: {
        sourceId: '7',
        kind: 'person',
        name: 'Line Kjær',
        email: 'line.kjaer@example.dk',
        ean: '5798000000001',
        isGuest: false,
      },
    });
    expect(o!.lines).toEqual([
      expect.objectContaining({
        name: 'Elcykel Nordlys E7',
        sku: 'E7-M',
        quantity: 1,
        unitPrice: 1519600,
        discount: 151960,
        vatRate: 0.25,
        category: 'Cykler',
        kind: 'product',
      }),
      expect.objectContaining({ name: 'Gebyr', unitPrice: 2000, vatRate: 0.25, kind: 'fee' }),
    ]);
    expect(o!.vatLines).toEqual([
      { rateId: '1', code: 'DK-MOMS-1', label: 'Moms', rate: 0.25, amount: 343390 },
    ]);
    // Tracking meta stays out of the payload the developer view shows.
    expect((o!.raw as WooOrder).meta_data!.map((m) => m.key)).toEqual(['_billing_ean']);
    expect(saleKind(o!)).toBe('domestic');
  });

  it('reads a guest EU B2B order with a plugin order number and a bundle', async () => {
    const o = (await adapter().get('order', '1002')) as Order;
    expect(o).toMatchObject({
      number: 'WEB-1002',
      status: 'pending',
      sourceStatus: 'on-hold',
      customer: {
        sourceId: 'guest:einkauf@weber.example',
        kind: 'company',
        name: 'Hans Weber GmbH',
        vatNumber: 'DE811000001',
        isGuest: true,
      },
    });
    // The bundle child without its own price is carried by the parent line.
    expect(o.lines.map((l) => l.name)).toEqual(['Cykelsæt']);
    expect(saleKind(o)).toBe('euB2b');
    expect(await adapter().get('order', '9999')).toBeNull();
    expect(await adapter().get('order', '../x')).toBeNull();
  });

  it('reads changes since the cursor, oldest first, with Basic auth', async () => {
    const t = shop();
    await adapter(t).fetch('order', { limit: 50, since: '2026-10-18T09:58:00.000Z' });
    const first = t.sent[0]!;
    expect(first.url.pathname).toBe('/wp-json/wc/v3/orders');
    expect(Object.fromEntries(first.url.searchParams)).toMatchObject({
      orderby: 'modified',
      order: 'asc',
      dates_are_gmt: 'true',
      modified_after: '2026-10-18T09:58:00Z',
      per_page: '50',
      page: '1',
    });
    expect(first.headers.authorization).toBe(
      `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`,
    );
  });
});

describe('refunds as credit notes', () => {
  it('reads the refunds of changed orders, with positive amounts', async () => {
    const notes = (await adapter().fetch('creditNote', { limit: 10 })) as CreditNote[];
    expect(notes.map((n) => [n.sourceId, n.orderSourceId, n.total, n.refundsPayment])).toEqual([
      ['901', '1001', 50000, true],
      ['902', '1001', 1709550, false],
    ]);
    // An amount-only refund is one line at the order's VAT rate.
    expect(notes[0]!.lines).toEqual([
      expect.objectContaining({ name: 'Ridse i lakken', unitPrice: 40000, vatRate: 0.25 }),
    ]);
    expect(notes[1]!.lines).toEqual([
      expect.objectContaining({
        name: 'Elcykel Nordlys E7',
        quantity: 1,
        unitPrice: 1367640,
        vatRate: 0.25,
      }),
    ]);
    expect(notes[0]!.meta).toMatchObject({ orderNumber: '1001' });
  });

  it('reads one refund by id through /refunds', async () => {
    const n = (await adapter().get('creditNote', '901')) as CreditNote;
    expect(n).toMatchObject({ sourceId: '901', orderSourceId: '1001', reason: 'Ridse i lakken' });
    expect(await adapter().get('creditNote', '12345')).toBeNull();
  });
});

describe('connection', () => {
  it('tests the keys and reports the shop', async () => {
    expect(await adapter().test()).toEqual({
      ok: true,
      account: { id: 'nordlys-cykler.example', name: 'nordlys-cykler.example' },
    });
    const denied = fakeTransport([
      {
        method: 'GET',
        path: /orders/,
        reply: () => ({ status: 401, json: { code: 'woocommerce_rest_cannot_view' } }),
      },
    ]);
    expect(await adapter(denied).test()).toMatchObject({ ok: false, reason: 'unauthorized' });
    const html = fakeTransport([
      {
        method: 'GET',
        path: /orders/,
        reply: () => ({ status: 200, body: '<html>Cloudflare</html>' }),
      },
    ]);
    expect(await adapter(html).test()).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('falls back to query-string keys when the host strips the header, and remembers it', async () => {
    const t = shop({ stripAuth: true });
    const persisted: Record<string, string>[] = [];
    expect((await adapter(t, {}, persisted).test()).ok).toBe(true);
    expect(t.sent[1]!.url.searchParams.get('consumer_key')).toBe('ck_test');
    expect(persisted).toEqual([{ authMode: 'query' }]);
  });

  it('counts records with X-WP-Total and lists live lookups', async () => {
    expect(await adapter().count('order')).toBe(2);
    expect(await adapter().lookup('orderStatuses')).toEqual([
      { value: 'processing', label: 'Behandles' },
      { value: 'awaiting-shipment', label: 'Afventer forsendelse' },
    ]);
    expect(await adapter().lookup('paymentGateways')).toEqual([
      { value: 'quickpay', label: 'Kort' },
    ]);
    expect(await adapter().lookup('accounts')).toEqual([]);
  });

  it('refuses incomplete credentials', () => {
    expect(() =>
      openAdapter({ connectorId: 'woocommerce', mode: 'live', credentials: { baseUrl: BASE } }),
    ).toThrow(/incomplete/);
  });
});

describe('writes', () => {
  it('writes stock to the variation with the SKU, never below 0, and not on dry runs', async () => {
    const t = shop();
    const a = adapter(t);
    expect(
      await a.write(
        'stock',
        { sourceId: 's1', sku: 'HELM-PRO-M', quantity: -2 },
        { mode: 'dry_run' },
      ),
    ).toEqual({ action: 'update', destinationId: null });
    expect(t.sent.some((s) => s.method === 'PUT')).toBe(false);
    expect(
      await a.write('stock', { sourceId: 's1', sku: 'HELM-PRO-M', quantity: -2 }, { mode: 'live' }),
    ).toEqual({ action: 'update', destinationId: '50:51' });
    const put = t.sent.find((s) => s.method === 'PUT')!;
    expect(put.url.pathname).toBe('/wp-json/wc/v3/products/50/variations/51');
    expect(put.body).toEqual({ manage_stock: true, stock_quantity: 0 });
    await expect(
      a.write('stock', { sourceId: 's2', sku: 'NOPE', quantity: 1 }, { mode: 'live' }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('refunds once per credit note, even when called twice', async () => {
    const t = shop({
      refunds: [
        { ...REFUND_AMOUNT, meta_data: [{ key: '_agentor_credit_note', value: 'dinero:cn-1' }] },
      ],
    });
    const a = adapter(t);
    expect(
      await a.createRefund('1001', {
        amount: 50000,
        reason: 'Kreditnota 7',
        tag: 'dinero:cn-1',
        throughGateway: true,
        restock: false,
      }),
    ).toEqual({ refundId: '901', existed: true });
    expect(t.sent.some((s) => s.method === 'POST')).toBe(false);
    expect(
      await a.createRefund('1001', {
        amount: 25000,
        reason: 'Kreditnota 8',
        tag: 'dinero:cn-2',
        throughGateway: true,
        restock: false,
      }),
    ).toEqual({ refundId: '950', existed: false });
    expect(t.sent.find((s) => s.method === 'POST')!.body).toEqual({
      amount: '250.00',
      reason: 'Kreditnota 8',
      api_refund: true,
      api_restock: false,
      meta_data: [{ key: '_agentor_credit_note', value: 'dinero:cn-2' }],
    });
  });
});

describe('webhooks', () => {
  it('reads the topic and id, and polls refunds after order changes', () => {
    const a = adapter();
    expect(
      a.parseWebhook('{"id":1001}', {
        'x-wc-webhook-topic': 'order.updated',
        'x-wc-webhook-id': '5',
        'x-wc-webhook-delivery-id': 'd-1',
      }),
    ).toEqual({
      entity: 'order',
      sourceIds: ['1001'],
      deliveryId: '5:d-1',
      alsoPoll: ['creditNote'],
    });
    expect(a.parseWebhook('{"id":7}', { 'x-wc-webhook-topic': 'customer.created' })).toMatchObject({
      entity: 'customer',
      sourceIds: ['7'],
    });
    expect(a.parseWebhook('webhook_id=5', { 'x-wc-webhook-topic': 'order.updated' })).toBeNull();
    expect(a.parseWebhook('{"id":1}', { 'x-wc-webhook-topic': 'coupon.updated' })).toBeNull();
  });

  it('creates missing webhooks, revives disabled ones and removes old addresses', async () => {
    const name = 'Agentor c0ffee00';
    const t = shop({
      hooks: [
        { id: 1, name, topic: 'order.updated', status: 'disabled', delivery_url: HOOK },
        {
          id: 2,
          name,
          topic: 'order.created',
          status: 'active',
          delivery_url: 'https://ingest.agentor.example/hooks/old',
        },
        {
          id: 3,
          name: 'Some other app',
          topic: 'order.created',
          status: 'active',
          delivery_url: 'https://other.example',
        },
      ],
    });
    const persisted: Record<string, string>[] = [];
    const status = await adapter(
      t,
      { webhookUrl: HOOK, webhookSecret: 'sec' },
      persisted,
    ).ensureWebhooks();
    expect(status).toEqual([
      { topic: 'order.created', status: 'created' },
      { topic: 'order.updated', status: 'reactivated' },
      { topic: 'order.deleted', status: 'created' },
      { topic: 'customer.created', status: 'created' },
      { topic: 'customer.updated', status: 'created' },
      { topic: 'product.updated', status: 'created' },
    ]);
    expect(t.sent.filter((s) => s.method === 'DELETE').map((s) => s.url.pathname)).toEqual([
      '/wp-json/wc/v3/webhooks/2',
    ]);
    expect(t.sent.find((s) => s.method === 'POST')!.body).toEqual({
      name,
      topic: 'order.created',
      delivery_url: HOOK,
      secret: 'sec',
      status: 'active',
    });
    expect(persisted).toEqual([]);
  });

  it('makes and stores a signing secret before registering', async () => {
    const persisted: Record<string, string>[] = [];
    await adapter(shop(), { webhookUrl: HOOK }, persisted).ensureWebhooks();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.webhookSecret).toMatch(/^[\w-]{40,}$/);
    expect(await adapter().ensureWebhooks()).toEqual([]);
  });
});

describe('deliveries and invoice status from the ERP', () => {
  const CONN = 'c0ffee00-1111-2222-3333-444455556666';
  function erpShop() {
    return fakeTransport([
      {
        method: 'GET',
        path: /\/orders$/,
        reply: () => ({ json: [{ ...DK_ORDER, id: 1500, number: '10447' }] }),
      },
      {
        method: 'POST',
        path: /\/orders\/(\d+)\/notes$/,
        reply: () => ({ status: 201, json: { id: 1 } }),
      },
      { method: 'PUT', path: /\/orders\/(\d+)$/, reply: () => ({ json: { id: 1 } }) },
    ]);
  }
  const erpAdapter = (t: ReturnType<typeof erpShop>) =>
    new WooAdapter({
      connectorId: 'woocommerce',
      mode: 'live',
      connectionId: CONN,
      credentials: { baseUrl: BASE, consumerKey: 'ck_test', consumerSecret: 'cs_test' },
      transport: t.transport,
    });
  const shipment: Shipment = {
    sourceId: '500',
    number: 'WH/OUT/00042',
    orderRef: '10447',
    orderSource: { connectionId: CONN, sourceId: '1001' },
    state: 'done',
    doneAt: '2026-10-24T10:00:00.000Z',
    carrier: 'GLS',
    trackingRef: '0034043',
    trackingUrl: null,
    lines: [],
  };

  it('notes the tracking and completes the order Agentor created it from', async () => {
    const t = erpShop();
    const res = await erpAdapter(t).write('shipment', shipment, {
      mode: 'live',
      fields: { 'note.text': 'Sendt med GLS: 0034043' },
      route: {
        settings: { 'shipment.status': 'completed', 'shipment.customerNote': true },
        mapping: {},
        tables: {},
      },
    });
    expect(res).toEqual({ action: 'update', destinationId: '1001:shipment:500' });
    expect(t.sent.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'POST /wp-json/wc/v3/orders/1001/notes',
      'PUT /wp-json/wc/v3/orders/1001',
    ]);
    expect(t.sent[0]!.body).toEqual({ note: 'Sendt med GLS: 0034043', customer_note: true });
    expect(t.sent[1]!.body).toEqual({ status: 'completed' });
  });

  it('finds the order by number when another connection made it', async () => {
    const t = erpShop();
    const res = await erpAdapter(t).write(
      'shipment',
      { ...shipment, orderSource: { connectionId: 'other', sourceId: '9' } },
      { mode: 'live', route: { settings: { 'shipment.status': '' }, mapping: {}, tables: {} } },
    );
    expect(res.destinationId).toBe('1500:shipment:500');
    expect(t.sent.filter((s) => s.method !== 'GET')).toEqual([]);
  });

  it('writes each invoice event once', async () => {
    const t = erpShop();
    const a = erpAdapter(t);
    const inv: InvoiceStatus = {
      sourceId: '900',
      kind: 'invoice',
      number: 'INV/2026/00123',
      orderRef: '10447',
      orderSource: { connectionId: CONN, sourceId: '1001' },
      state: 'posted',
      paymentState: 'notPaid',
      currency: 'DKK',
      total: 100,
      residual: 100,
      date: null,
      dueDate: null,
    };
    const route = {
      settings: { 'invoice.events': ['posted', 'paid'], 'invoice.statusOnPaid': 'completed' },
      mapping: {},
      tables: {},
    };
    const fields = { 'note.posted': 'Bogført', 'note.paid': 'Betalt' };
    const first = await a.write('invoiceStatus', inv, { mode: 'live', fields, route });
    expect(first.destinationId).toBe('1001:invoice:900:posted');
    const again = await a.write('invoiceStatus', inv, {
      mode: 'live',
      fields,
      route,
      existingId: first.destinationId,
    });
    expect(again.action).toBe('skip');
    const paid = await a.write(
      'invoiceStatus',
      { ...inv, paymentState: 'paid' },
      { mode: 'live', fields, route, existingId: first.destinationId },
    );
    expect(paid.destinationId).toBe('1001:invoice:900:posted:paid');
    expect(t.sent.map((s) => s.body)).toEqual([
      { note: 'Bogført', customer_note: false },
      { note: 'Betalt', customer_note: false },
      { status: 'completed' },
    ]);
  });
});

adapterContract('WooCommerce (recorded)', woocommerce, (credentials) =>
  adapter(shop(), credentials ?? {}),
);
