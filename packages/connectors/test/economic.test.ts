import { describe, expect, it } from 'vitest';
import {
  economic,
  verifyWebhook,
  WriteError,
  type CreditNote,
  type Customer,
  type Order,
  type WriteOptions,
} from '../src/index.js';
import {
  countryCode,
  countryName,
  economicInstallUrl,
  EconomicAdapter,
  filterValue,
  openAdapter,
  orderRefRegExp,
  toInvoiceStatus,
} from '../src/live/index.js';
import { agreement, fakeEconomic, type FakeEconomic } from './fake-economic.js';

/** e-conomic as destination and source against a recorded agreement (PLAN-INTEGRATIONS-ECONOMIC). */

const APP = {
  appSecretToken: 'app-secret',
  restUrl: 'https://restapi.e-conomic.test',
  apisUrl: 'https://apis.e-conomic.test',
};
const NOW = Date.parse('2026-10-25T12:00:00Z');

function adapter(db: FakeEconomic = agreement(), extra: Record<string, unknown> = {}) {
  const fake = fakeEconomic(db);
  const persisted: Record<string, string>[] = [];
  const a = new EconomicAdapter({
    connectorId: 'economic',
    mode: 'live',
    credentials: { grantToken: 'grant-ok', webhookUrl: 'https://ingest.agentor.test/hooks/tok' },
    settings: {},
    app: APP,
    transport: fake.transport,
    connectionId: 'c0ffee00-1111-2222-3333-444455556666',
    now: () => NOW,
    persist: async (p) => {
      persisted.push(p);
    },
    ...extra,
  });
  return { a, db, sent: fake.sent, persisted };
}

const lineKjaer: Customer = {
  sourceId: '7',
  kind: 'person',
  name: 'Line Kjær',
  email: 'line.kjaer@example.dk',
  phone: '+4520202020',
  vatNumber: null,
  address: { line1: 'Søndergade 12', postalCode: '8000', city: 'Aarhus C', country: 'DK' },
};

const order: Order = {
  sourceId: '1001',
  number: '1001',
  createdAt: '2026-10-18T22:30:00.000Z',
  paidAt: '2026-10-18T22:31:00.000Z',
  status: 'processing',
  currency: 'DKK',
  customer: lineKjaer,
  lines: [
    {
      sku: 'E7-M',
      productId: '42',
      name: 'Elcykel Nordlys E7',
      quantity: 1,
      unitPrice: 1519600,
      vatRate: 0.25,
      category: 'Cykler',
      discount: 151960,
    },
  ],
  shipping: 3920,
  shippingVatRate: 0.25,
  shippingMethod: 'GLS Pakkeshop',
  total: 1714450,
  paymentMethod: { id: 'quickpay', title: 'Kort' },
  transactionId: 'qp-778',
};

const route = (
  settings: Record<string, unknown> = {},
  patch: Partial<NonNullable<WriteOptions['route']>> = {},
): NonNullable<WriteOptions['route']> => ({
  settings: { 'payment.journal': '2', 'paymentTerms.paid': '5', ...settings },
  mapping: { 'products.generic': 'WEB', 'products.shipping': 'FRAGT', 'products.rounding': 'ORE' },
  tables: { paymentMethods: [{ from: 'quickpay', account: '5830' }] },
  ...patch,
});

const invoiceOpts = (o: Partial<WriteOptions> = {}): WriteOptions => ({
  mode: 'draft',
  refs: { 'customer:7': '1' },
  fields: {
    'invoice.externalId': 'ag:c0ffee00:o:1001',
    'invoice.otherReference': '1001',
    'invoice.heading': 'Ordre 1001',
  },
  route: route(),
  ...o,
});

describe('e-conomic connection', () => {
  it('tests with /self and stores the plan and base currency', async () => {
    const { a, sent, persisted } = adapter();
    const r = await a.test();
    expect(r).toEqual({ ok: true, account: { id: '771204', name: 'Nordlys Outlet ApS' } });
    expect(sent[0]!.headers['x-appsecrettoken']).toBe('app-secret');
    expect(sent[0]!.headers['x-agreementgranttoken']).toBe('grant-ok');
    expect(sent[0]!.headers['content-type']).toBe('application/json');
    expect(persisted[0]).toMatchObject({ planLevel: 'plus', baseCurrency: 'DKK' });
  });

  it('reports a revoked grant as unauthorized', async () => {
    const fake = fakeEconomic(agreement());
    const a = new EconomicAdapter({
      connectorId: 'economic',
      mode: 'live',
      credentials: { grantToken: 'revoked' },
      app: APP,
      transport: fake.transport,
    });
    expect(await a.test()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('fails the test when the platform has no app secret', async () => {
    const { a } = adapter(agreement(), { app: { ...APP, appSecretToken: '' } });
    expect(await a.test()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('opens the live client in live mode', () => {
    const a = openAdapter({
      connectorId: 'economic',
      mode: 'live',
      credentials: { grantToken: 'grant-ok' },
      economic: APP,
    });
    expect(a).toBeInstanceOf(EconomicAdapter);
  });

  it('lists lookups: accounts without headings, with VAT codes', async () => {
    const { a } = adapter();
    const accounts = await a.lookup('accounts');
    expect(accounts.map((x) => x.value)).toEqual(['1010', '1015', '1090', '5820', '5830']);
    expect(accounts[0]).toMatchObject({ label: 'Salg af varer', vatCode: 'U25' });
    expect((await a.lookup('vatZones')).map((z) => z.value)).toEqual(['1', '2', '3', '13']);
    expect((await a.lookup('paymentTerms'))[1]).toMatchObject({
      value: '5',
      meta: { type: 'paidInCash', days: 0 },
    });
    expect((await a.lookup('productGroups'))[0]!.meta).toEqual({ inventory: true });
    expect((await a.lookup('products')).map((p) => p.value)).toContain('E7-M');
  });

  it('counts customers and products', async () => {
    const { a } = adapter();
    expect(await a.count('customer')).toBe(2);
    expect(await a.count('product')).toBe(4);
    expect(await a.count('order')).toBeNull();
  });
});

describe('e-conomic customers', () => {
  it('finds a customer by e-mail and only writes changed, chosen fields', async () => {
    const { a, db, sent } = adapter();
    const r = await a.write(
      'customer',
      { ...lineKjaer, phone: '+4511111111' },
      {
        mode: 'live',
        route: route({ 'contact.match': 'email' }),
      },
    );
    expect(r).toEqual({ action: 'update', destinationId: '1' });
    const put = sent.find((s) => s.method === 'PUT')!;
    expect(put.path).toBe('/customers/1');
    // The full customer goes back (PUT replaces it), with the new phone number.
    expect(put.body).toMatchObject({
      name: 'Line Kjær',
      mobilePhone: '+4511111111',
      currency: 'DKK',
    });
    expect(put.body).not.toHaveProperty('balance');
    expect(db.customers[0]!.mobilePhone).toBe('+4511111111');
  });

  it('creates a foreign company with its VAT zone, group and attention person', async () => {
    const { a, db, sent } = adapter();
    const c: Customer = {
      sourceId: '88',
      kind: 'company',
      name: 'Jonas Weber',
      companyName: 'Velo Berlin GmbH',
      email: 'jonas@velo.example',
      phone: null,
      vatNumber: 'DE299999999',
      address: { line1: 'Torstraße 1', postalCode: '10119', city: 'Berlin', country: 'DE' },
    };
    const r = await a.write('customer', c, {
      mode: 'live',
      route: route({ 'contact.match': 'email', 'contact.groupForeign': '2' }),
    });
    expect(r.action).toBe('create');
    const created = db.customers.find((x) => x.customerNumber === Number(r.destinationId))!;
    expect(created).toMatchObject({
      name: 'Velo Berlin GmbH',
      country: 'Tyskland',
      corporateIdentificationNumber: 'DE299999999',
      vatZone: { vatZoneNumber: 2 },
      customerGroup: { customerGroupNumber: 2 },
      paymentTerms: { paymentTermsNumber: 1 },
      attention: { customerContactNumber: 1 },
    });
    expect(sent.find((s) => s.path.endsWith('/contacts'))!.body).toMatchObject({
      name: 'Jonas Weber',
    });
    expect(
      sent.find((s) => s.method === 'POST' && s.path === '/customers')!.headers['idempotency-key'],
    ).toMatch(/^agentor-/);
  });

  it('uses the shop number as customer number when chosen, and one shared customer for none', async () => {
    const { a, db } = adapter();
    const r = await a.write(
      'customer',
      { ...lineKjaer, email: 'ny@example.dk' },
      {
        mode: 'live',
        route: route({ 'contact.match': 'number', 'contact.numberOffset': 100000 }),
      },
    );
    expect(r).toEqual({ action: 'create', destinationId: '100007' });
    expect(db.customers.at(-1)!.customerNumber).toBe(100007);
    const shared = await a.write('customer', lineKjaer, {
      mode: 'live',
      route: route({ 'contact.match': 'none', 'contact.shared': 99 }),
    });
    expect(shared).toEqual({ action: 'skip', destinationId: '99' });
  });
});

describe('e-conomic invoices', () => {
  it('creates a Q2C draft with external id, products, discount and shipping (Kladde)', async () => {
    const { a, db, sent } = adapter();
    const r = await a.write('order', order, invoiceOpts());
    expect(r.action).toBe('create');
    expect(r.destinationId).toMatch(/^d:\d+$/);
    const draft = db.drafts[0]!;
    expect(draft).toMatchObject({
      customerNumber: 1,
      externalId: 'ag:c0ffee00:o:1001',
      otherReference: '1001',
      heading: 'Ordre 1001',
      vatZoneNumber: 1,
      termOfPaymentNumber: 5,
      layoutNumber: 21,
      currencyCode: 'DKK',
      // Paid 22:31 UTC is 00:31 the next day in Copenhagen.
      date: '2026-10-19',
      customerCountry: 'Danmark',
    });
    const lines = db.draftLines.filter((l) => l.documentId === draft.number);
    expect(lines).toEqual([
      expect.objectContaining({
        productNumber: 'E7-M',
        quantity: 1,
        unitNetPrice: 15196,
        discountPercentage: 10,
      }),
      expect.objectContaining({
        productNumber: 'FRAGT',
        description: 'GLS Pakkeshop',
        unitNetPrice: 39.2,
      }),
    ]);
    const post = sent.find(
      (s) => s.family === 'q2c' && s.method === 'POST' && s.path === '/invoices/drafts',
    )!;
    expect(post.headers['idempotency-key']).toMatch(/^agentor-/);
    expect(db.booked).toHaveLength(0);
    expect(r.warnings).toBeUndefined();
  });

  it('books in Live and registers the payment in the journal, booking only our entry', async () => {
    const { a, db, sent } = adapter();
    const r = await a.write(
      'order',
      order,
      invoiceOpts({
        mode: 'live',
        route: route({ 'invoice.bookAutomatically': true, 'payment.book': true }),
      }),
    );
    expect(r).toEqual({ action: 'create', destinationId: 'b:1' });
    expect(db.booked[0]).toMatchObject({ bookedInvoiceNumber: 1, grossAmount: 17144.5 });
    const entry = db.entries[0]!;
    expect(entry).toMatchObject({
      entryTypeNumber: 2,
      journalNumber: 2,
      amount: -17144.5,
      customerNumber: 1,
      customerInvoiceNumber: '1',
      contraAccountNumber: 5830,
      currency: 'DKK',
      date: '2026-10-19',
      booked: true,
    });
    const book = sent.find((s) => s.path === '/journals/2/bookdraftentries')!;
    expect(book.body).toEqual({ entryNumbers: [entry.entryNumber] });
    expect(sent.some((s) => s.path === '/journals/2/book')).toBe(false);
  });

  it('leaves the payment in the kassekladde by default, and warns when no journal is set', async () => {
    const { a, db } = adapter();
    await a.write(
      'order',
      order,
      invoiceOpts({ mode: 'live', route: route({ 'invoice.bookAutomatically': true }) }),
    );
    expect(db.entries[0]!.booked).toBe(false);
    const other = adapter();
    const r = await other.a.write(
      'order',
      order,
      invoiceOpts({
        mode: 'live',
        route: route({ 'invoice.bookAutomatically': true, 'payment.journal': '' }, { tables: {} }),
      }),
    );
    expect(r.warnings).toEqual([
      { code: 'PAYMENT_NOT_REGISTERED', params: { method: 'quickpay' } },
    ]);
  });

  it('never changes a booked invoice, and warns when the order changed', async () => {
    const { a } = adapter();
    const live = invoiceOpts({ mode: 'live', route: route({ 'invoice.bookAutomatically': true }) });
    await a.write('order', order, live);
    expect(await a.write('order', order, { ...live, existingId: 'b:1' })).toEqual({
      action: 'skip',
      destinationId: 'b:1',
    });
    const changed = await a.write('order', { ...order, total: 1800000 }, live);
    expect(changed).toMatchObject({
      action: 'skip',
      destinationId: 'b:1',
      warnings: [{ code: 'CHANGED_AFTER_BOOKING', params: { order: '1001' } }],
    });
  });

  it('updates a draft found by external id: header PUT with objectVersion, lines replaced', async () => {
    const { a, db, sent } = adapter();
    await a.write('order', order, invoiceOpts());
    const changed: Order = {
      ...order,
      lines: [{ ...order.lines[0]!, quantity: 2, discount: 0 }],
      total: 3803900,
    };
    const r = await a.write('order', changed, invoiceOpts());
    expect(r.action).toBe('update');
    const put = sent.find((s) => s.method === 'PUT' && s.family === 'q2c')!;
    expect(put.body).toMatchObject({ objectVersion: 'v1', externalId: 'ag:c0ffee00:o:1001' });
    const lines = db.draftLines.filter((l) => l.documentId === db.drafts[0]!.number);
    expect(lines.map((l) => [l.productNumber, l.quantity])).toEqual([
      ['E7-M', 2],
      ['FRAGT', 1],
    ]);
    expect(db.drafts).toHaveLength(1);
  });

  it('retries a draft PUT once after a stale objectVersion', async () => {
    const { a, db } = adapter();
    await a.write('order', order, invoiceOpts());
    db.drafts[0]!.objectVersion = 'v9';
    const r = await a.write('order', order, invoiceOpts());
    expect(r.action).toBe('update');
  });

  it('finds an invoice the bookkeeper booked by its reference and customer', async () => {
    const db = agreement();
    db.booked.push({
      bookedInvoiceNumber: 40,
      grossAmount: 17144.5,
      remainder: 0,
      customer: { customerNumber: 1 },
      references: { other: '1001' },
    });
    const { a } = adapter(db);
    expect(await a.write('order', order, invoiceOpts())).toEqual({
      action: 'skip',
      destinationId: 'b:40',
    });
  });

  it('adds a rounding line within the limit and stops above it', async () => {
    const { a, db } = adapter();
    const r = await a.write('order', { ...order, total: order.total + 3 }, invoiceOpts());
    expect(r.warnings).toEqual([
      { code: 'TOTAL_ROUNDED', params: { diff: '0.03', economic: '17144.5', shop: '17144.53' } },
    ]);
    expect(db.draftLines.at(-1)).toMatchObject({ productNumber: 'ORE', unitNetPrice: 0.03 });
    const over = adapter();
    await expect(
      over.a.write('order', { ...order, total: order.total + 500 }, invoiceOpts()),
    ).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('uses the standard product for unknown SKUs, or stops, or creates the product', async () => {
    const unknown: Order = {
      ...order,
      lines: [{ ...order.lines[0]!, sku: 'NEW-1', category: 'Tøj' }],
    };
    const one = adapter();
    await one.a.write('order', unknown, invoiceOpts());
    expect(one.db.draftLines[0]).toMatchObject({
      productNumber: 'WEB',
      description: 'Elcykel Nordlys E7',
    });

    const two = adapter();
    await expect(
      two.a.write('order', unknown, invoiceOpts({ route: route({ 'products.missing': 'fail' }) })),
    ).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('NEW-1') });

    const three = adapter();
    await three.a.write(
      'order',
      unknown,
      invoiceOpts({
        route: route(
          { 'products.missing': 'create' },
          { tables: { productGroups: [{ from: 'Tøj', group: '1' }] } },
        ),
      }),
    );
    expect(three.db.products.at(-1)).toMatchObject({
      productNumber: 'NEW-1',
      productGroup: { productGroupNumber: 1 },
      salesPrice: 15196,
    });
    expect(three.db.draftLines[0]).toMatchObject({ productNumber: 'NEW-1' });
  });

  it('matches products by EAN when chosen', async () => {
    const { a, db } = adapter();
    const byEan: Order = {
      ...order,
      lines: [{ ...order.lines[0]!, sku: 'shop-sku', ean: '5700000000010' }],
    };
    await a.write('order', byEan, invoiceOpts({ route: route({ 'products.match': 'barcode' }) }));
    expect(db.draftLines[0]).toMatchObject({ productNumber: 'E7-M' });
  });

  it('picks the VAT zone by sale kind, and the buyer country zone under OSS', async () => {
    const de: Customer = {
      ...lineKjaer,
      sourceId: '9',
      address: { ...lineKjaer.address, country: 'DE' },
    };
    const deOrder: Order = {
      ...order,
      customer: de,
      lines: [{ ...order.lines[0]!, vatRate: 0.19 }],
      shippingVatRate: 0.19,
    };
    const oss = adapter();
    await oss.a.write(
      'order',
      deOrder,
      invoiceOpts({
        refs: { 'customer:9': '1' },
        route: route({
          'oss.mode': 'destinationVat',
          'rounding.policy': 'ignoreBelow',
          'rounding.maxDiff': 100000,
        }),
      }),
    );
    expect(oss.db.drafts[0]!.vatZoneNumber).toBe(13);

    const b2b = adapter();
    await b2b.a.write(
      'order',
      {
        ...deOrder,
        customer: { ...de, kind: 'company', vatNumber: 'DE811234567' },
        lines: [{ ...order.lines[0]!, vatRate: 0 }],
        shippingVatRate: 0,
        total: 1371560,
      },
      invoiceOpts({ refs: { 'customer:9': '2' } }),
    );
    expect(b2b.db.drafts[0]!.vatZoneNumber).toBe(2);

    const us = adapter();
    await us.a.write(
      'order',
      {
        ...deOrder,
        customer: { ...de, address: { ...de.address, country: 'US' } },
        lines: [{ ...order.lines[0]!, vatRate: 0 }],
        shippingVatRate: 0,
        total: 1371560,
      },
      invoiceOpts({
        refs: { 'customer:9': '1' },
        route: route({}, { mapping: { ...route().mapping, 'zones.export': '3' } }),
      }),
    );
    expect(us.db.drafts[0]!.vatZoneNumber).toBe(3);
  });

  it('sends prices incl. VAT when the zone makes the draft include VAT', async () => {
    const db = agreement();
    db.vatIncludedZones = [1];
    const { a } = adapter(db);
    const r = await a.write('order', order, invoiceOpts());
    expect(r.warnings).toBeUndefined();
    expect(db.draftLines[0]).toMatchObject({ unitNetPrice: 18995 });
  });

  it('books with the shop number and as an e-invoice when chosen', async () => {
    const { a, db, sent } = adapter();
    await a.write(
      'order',
      { ...order, customer: { ...lineKjaer, ean: '5798000000001' } },
      invoiceOpts({
        mode: 'live',
        route: route({
          'invoice.bookAutomatically': true,
          'invoice.bookWithShopNumber': true,
          'send.eInvoice': true,
        }),
      }),
    );
    expect(db.booked[0]).toMatchObject({ bookedInvoiceNumber: 1001, sendBy: 'EAN' });
    expect(db.drafts).toHaveLength(0);
    expect(
      sent.find((s) => s.path === '/invoices/booked' && s.method === 'POST')!.body,
    ).toMatchObject({
      bookWithNumber: 1001,
      sendBy: 'EAN',
    });
  });

  it('checks products in a test run without writing', async () => {
    const { a, sent } = adapter();
    const r = await a.write('order', order, invoiceOpts({ mode: 'dry_run', refs: {} }));
    expect(r).toEqual({ action: 'create', destinationId: null });
    expect(sent.filter((s) => s.method !== 'GET')).toHaveLength(0);
  });

  it('requires a non-empty reference, and refuses writes on a Basis agreement', async () => {
    const { a } = adapter();
    await expect(
      a.write('order', order, invoiceOpts({ fields: { 'invoice.otherReference': ' ' } })),
    ).rejects.toMatchObject({ kind: 'invalid' });
    const basis = adapter(agreement(), {
      credentials: { grantToken: 'grant-ok', planLevel: 'basis' },
    });
    await expect(basis.a.write('order', order, invoiceOpts())).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('maps e-conomic errors: field messages, rate limit', async () => {
    const db = agreement();
    db.errors = {
      'POST /invoices/drafts': {
        status: 400,
        body: {
          title: 'Validation failed',
          errors: [{ property: 'layoutNumber', message: 'Layout does not exist.' }],
          traceId: 't-1',
        },
      },
    };
    const { a } = adapter(db);
    const e = await a.write('order', order, invoiceOpts()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WriteError);
    expect((e as WriteError).kind).toBe('invalid');
    expect((e as WriteError).message).toContain('layoutNumber: Layout does not exist.');
    expect((e as WriteError).message).toContain('t-1');
    db.errors = { 'GET /invoices/drafts': { status: 429, body: { title: 'Too many' } } };
    await expect(a.write('order', order, invoiceOpts())).rejects.toMatchObject({
      kind: 'rate_limited',
    });
  });
});

describe('e-conomic journal vouchers', () => {
  it('posts one voucher per order on the engine accounts with their VAT codes', async () => {
    const { a, db, sent } = adapter();
    const r = await a.write('order', order, {
      mode: 'live',
      refs: { 'customer:7': '1' },
      fields: { 'voucher.text': 'Ordre 1001' },
      route: route(
        { 'posting.type': 'journal', 'journal.number': '1', 'journal.book': true },
        { accounts: ['1010', '1090'] },
      ),
    });
    expect(r.destinationId).toMatch(/^j:1:\d+$/);
    expect(db.entries).toHaveLength(2);
    expect(db.entries[0]).toMatchObject({
      entryTypeNumber: 5,
      journalNumber: 1,
      accountNumber: 1010,
      vatCode: 'U25',
      amount: -17095.5,
      contraAccountNumber: 5830,
      booked: true,
    });
    expect(db.entries[1]).toMatchObject({
      accountNumber: 1090,
      amount: -49,
      voucherNumber: db.entries[0]!.voucherNumber,
    });
    expect(sent.find((s) => s.path === '/journals/1/bookdraftentries')!.body).toEqual({
      entryNumbers: db.entries.map((e) => e.entryNumber),
    });
  });
});

describe('e-conomic credit notes', () => {
  const refund: CreditNote = {
    sourceId: '1201',
    number: '1201',
    orderSourceId: '1001',
    createdAt: '2026-10-20T09:00:00.000Z',
    currency: 'DKK',
    customer: lineKjaer,
    lines: [{ ...order.lines[0]!, discount: 0, quantity: 1, unitPrice: 100000 }],
    total: 125000,
    reason: 'Ridse i lakken',
    refundsPayment: true,
    meta: { orderNumber: '1001', paymentMethod: 'quickpay' },
  };
  const cnOpts = (o: Partial<WriteOptions> = {}): WriteOptions => ({
    mode: 'live',
    refs: { 'customer:7': '1' },
    fields: {
      'creditNote.externalId': 'ag:c0ffee00:r:1201',
      'creditNote.invoiceReference': '1001',
      'creditNote.otherReference': '1001-R1201',
      'creditNote.heading': 'Kreditnota for ordre 1001',
    },
    route: route({ 'creditNote.bookAutomatically': true, 'creditNote.registerRefund': true }),
    ...o,
  });

  it('waits until the invoice is booked', async () => {
    const { a } = adapter();
    await expect(a.write('creditNote', refund, cnOpts())).rejects.toMatchObject({
      kind: 'transient',
      retryAfterMs: 3_600_000,
    });
  });

  it('books a negative invoice in the original zone and pays the refund back', async () => {
    const { a, db } = adapter();
    await a.write(
      'order',
      order,
      invoiceOpts({ mode: 'live', route: route({ 'invoice.bookAutomatically': true }) }),
    );
    const r = await a.write('creditNote', refund, cnOpts());
    expect(r).toEqual({ action: 'create', destinationId: 'b:2' });
    expect(db.booked[1]).toMatchObject({ grossAmount: -1250, references: { other: '1001-R1201' } });
    const refundEntry = db.entries.at(-1)!;
    expect(refundEntry).toMatchObject({
      entryTypeNumber: 2,
      amount: 1250,
      customerInvoiceNumber: '2',
    });
  });

  it('names the original invoice in the text', async () => {
    const { a, db, sent } = adapter();
    await a.write(
      'order',
      order,
      invoiceOpts({ mode: 'live', route: route({ 'invoice.bookAutomatically': true }) }),
    );
    await a.write('creditNote', refund, cnOpts({ mode: 'draft' }));
    const post = sent
      .filter((s) => s.family === 'q2c' && s.method === 'POST' && s.path === '/invoices/drafts')
      .at(-1)!;
    expect(post.body).toMatchObject({ textLine1: 'Kreditering af faktura 1', vatZoneNumber: 1 });
    expect(db.draftLines.at(-1)).toMatchObject({ quantity: -1, unitNetPrice: 1000 });
  });
});

describe('e-conomic as a source', () => {
  it('reads changed customers with ISO countries and VAT numbers', async () => {
    const { a, sent } = adapter();
    const rows = await a.fetch('customer', { limit: 50, since: '2026-10-21T00:00:00.123Z' });
    expect(sent[0]!.query.get('filter')).toBe('lastUpdated$gte:2026-10-21T00:00:00Z');
    expect(rows).toEqual([
      expect.objectContaining({
        sourceId: '2',
        kind: 'company',
        vatNumber: 'DE811234567',
        address: expect.objectContaining({ country: 'DE' }),
        updatedAt: '2026-10-22T08:00:00Z',
      }),
    ]);
    const all = await a.fetch('customer', { limit: 50 });
    expect(all[0]).toMatchObject({ sourceId: '1', kind: 'person', address: { country: 'DK' } });
  });

  it('reads products and stock from inventory groups, minus the safety buffer', async () => {
    const { a, sent } = adapter(agreement(), {
      settings: { 'stock.quantity': 'available', 'stock.safetyBuffer': 1 },
    });
    const products = await a.fetch('product', { limit: 50 });
    expect(products.map((p) => p.sku)).toEqual(['E7-M', 'WEB', 'FRAGT', 'ORE']);
    expect(products[0]).toMatchObject({
      price: 1519600,
      ean: '5700000000010',
      category: 'Varer m/moms',
    });
    const stock = await a.fetch('stock', { limit: 50 });
    expect(stock).toEqual([
      { sourceId: 'E7-M', sku: 'E7-M', quantity: 3 },
      { sourceId: 'WEB', sku: 'WEB', quantity: 0 },
      { sourceId: 'FRAGT', sku: 'FRAGT', quantity: 0 },
    ]);
    expect(sent.at(-1)!.query.get('filter')).toContain('productGroup.productGroupNumber$in:[1]');
    expect(await a.get('stock', 'E7-M')).toEqual({ sourceId: 'E7-M', sku: 'E7-M', quantity: 3 });
  });

  it('reads invoice status: paid, partial, credit notes, order number from the reference', async () => {
    const db = agreement();
    db.booked.push(
      {
        bookedInvoiceNumber: 1,
        date: '2026-10-18',
        currency: 'DKK',
        grossAmount: 1250,
        remainder: 0,
        references: { other: 'Ordre 1001' },
      },
      {
        bookedInvoiceNumber: 2,
        date: '2026-10-19',
        currency: 'DKK',
        grossAmount: 1000,
        remainder: 400,
        references: { other: 'Ordre 1002' },
      },
      {
        bookedInvoiceNumber: 3,
        date: '2026-10-20',
        currency: 'DKK',
        grossAmount: -250,
        remainder: -250,
        references: { other: '1001-R7' },
      },
      {
        bookedInvoiceNumber: 4,
        date: '2026-01-02',
        currency: 'DKK',
        grossAmount: 50,
        remainder: 50,
      },
    );
    const { a, sent } = adapter(db, { settings: { 'invoiceStatus.orderRefPattern': '(\\d+)' } });
    const rows = await a.fetch('invoiceStatus', { limit: 50 });
    expect(sent[0]!.query.get('filter')).toBe('date$gte:2026-07-27');
    expect(
      rows.map((r) => [r.number, r.kind, r.paymentState, r.orderRef, r.total, r.residual]),
    ).toEqual([
      ['3', 'creditNote', 'notPaid', '1001', 25000, 25000],
      ['2', 'invoice', 'partial', '1002', 100000, 40000],
      ['1', 'invoice', 'paid', '1001', 125000, 0],
    ]);
    expect(await a.get('invoiceStatus', '2')).toMatchObject({ paymentState: 'partial' });
  });

  it('keeps the whole reference as the order number without a pattern', () => {
    expect(
      toInvoiceStatus({
        bookedInvoiceNumber: 9,
        grossAmount: 10,
        remainder: 10,
        references: { other: '1009' },
      }).orderRef,
    ).toBe('1009');
  });
});

describe('e-conomic webhooks', () => {
  it('registers three hooks with the secret in a header and heals disabled ones', async () => {
    const { a, db, persisted } = adapter();
    const first = await a.ensureWebhooks();
    expect(first.map((h) => h.status)).toEqual(['created', 'created', 'created']);
    const secret = persisted.find((p) => p.webhookSecret)!.webhookSecret!;
    expect(db.webhooks[2]).toMatchObject({
      eventType: 'INVOICE_BOOKED',
      url: 'https://ingest.agentor.test/hooks/tok',
      contentType: 'application/json',
      customHeaders: [{ key: 'X-Agentor-Secret', value: secret }],
    });
    expect(JSON.parse(String(db.webhooks[2]!.postData))).toEqual({
      event: 'INVOICE_BOOKED',
      old: '[OLDNUMBER]',
      new: '[NEWNUMBER]',
      invoice: '[INVOICENO]',
    });
    db.webhooks[0]!.isDisabled = true;
    const again = await a.ensureWebhooks();
    expect(again.map((h) => h.status)).toEqual(['reactivated', 'active', 'active']);
    expect(db.webhooks[0]!.isDisabled).toBe(false);
  });

  it('registers nothing in poll mode', async () => {
    const { a, sent } = adapter(agreement(), { settings: { 'webhooks.mode': 'poll' } });
    expect(await a.ensureWebhooks()).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('reads webhook bodies as hints', () => {
    const { a } = adapter();
    expect(a.parseWebhook('{"event":"CUSTOMER_UPDATED","old":"[OLDNUMBER]","new":"12"}')).toEqual({
      entity: 'customer',
      sourceIds: ['12'],
      deliveryId: null,
    });
    expect(a.parseWebhook('{"event":"PRODUCT_UPDATED","old":"E7-M","new":"E7-M"}')).toMatchObject({
      entity: 'product',
      alsoPoll: ['stock'],
    });
    expect(a.parseWebhook('{"event":"INVOICE_BOOKED","invoice":"41"}')).toMatchObject({
      entity: 'invoiceStatus',
      sourceIds: ['41'],
    });
    expect(a.parseWebhook('{"event":"UNIT_UPDATED","new":"1"}')).toBeNull();
    expect(a.parseWebhook('not json')).toBeNull();
  });

  it('verifies the secret header in constant time', () => {
    expect(verifyWebhook('secret-header', '{}', 's3cret', 's3cret')).toBe(true);
    expect(verifyWebhook('secret-header', '{}', 'nope', 's3cret')).toBe(false);
    expect(verifyWebhook('secret-header', '{}', undefined, 's3cret')).toBe(false);
  });
});

describe('e-conomic helpers', () => {
  it('maps countries both ways', () => {
    expect(countryCode('Danmark')).toBe('DK');
    expect(countryCode('Germany')).toBe('DE');
    expect(countryCode('tyskland')).toBe('DE');
    expect(countryCode('se')).toBe('SE');
    expect(countryCode('Atlantis')).toBeNull();
    expect(countryName('DE')).toBe('Tyskland');
    expect(countryName('DE', 'en')).toBe('Germany');
  });

  it('escapes filter values', () => {
    expect(filterValue('a,b$(c)*[d]')).toBe('a$,b$$$(c$)$*$[d$]');
  });

  it('builds the installation URL with our state in the redirect', () => {
    const u = new URL(
      economicInstallUrl({
        appPublicToken: 'pub',
        redirectUrl: 'https://app.agentor.test/connect/economic/callback?state=abc',
      }),
    );
    expect(u.searchParams.get('appPublicToken')).toBe('pub');
    expect(u.searchParams.get('redirectUrl')).toBe(
      'https://app.agentor.test/connect/economic/callback?state=abc',
    );
    expect(u.searchParams.get('locale')).toBe('da-DK');
  });

  it('declares accounts as needed only for journal vouchers', () => {
    const accounts = economic.mapping!.order!.find((g) => g.key === 'accounts')!;
    expect(accounts.fields.every((f) => !f.required)).toBe(true);
    expect(accounts.fields.find((f) => f.key === 'accounts.domestic')!.requiredIf).toEqual({
      setting: 'posting.type',
      equals: 'journal',
    });
    expect(economic.webhook).toEqual({
      signatureHeader: 'x-agentor-secret',
      scheme: 'secret-header',
    });
  });
});

describe('order-reference pattern from the connection settings', () => {
  const ref = (other: string, pattern: string) =>
    toInvoiceStatus({ bookedInvoiceNumber: 1, grossAmount: 10, references: { other } }, pattern)
      .orderRef;

  it('takes the first group of a safe pattern', () => {
    expect(ref('Ordre 1042 / web', 'Ordre (\\d+)')).toBe('1042');
    expect(ref('ingen', '(\\d+)')).toBeNull();
  });

  it('refuses patterns that can backtrack without end, and uses the whole reference', () => {
    for (const p of ['(a+)+$', '(\\d*)*x', '(x+){2,}', '(a)\\1', 'x'.repeat(101)])
      expect(orderRefRegExp(p), p).toBeNull();
    const start = Date.now();
    expect(ref(`${'a'.repeat(40)}!`, '(a+)+$')).toBe(`${'a'.repeat(40)}!`);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('falls back to the whole reference for an invalid pattern', () => {
    expect(ref('1009', '(')).toBe('1009');
  });
});
