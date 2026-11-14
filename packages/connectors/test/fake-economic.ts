import type { HttpRequest, Transport } from '../src/live/http.js';

/**
 * A recorded e-conomic agreement for the live client's tests: REST at restapi.e-conomic.test and
 * the OpenAPI families (Q2C drafts, Journals, Webhooks) at apis.e-conomic.test. Collections are
 * plain rows; filters understand the subset the client sends (`$eq`, `$gte`, `$in`, `$and:`).
 * Every request is kept so a test can check what was sent.
 */

type Row = Record<string, unknown>;

export interface FakeEconomic {
  self?: Row;
  layouts: Row[];
  vatZones: Row[];
  paymentTerms: Row[];
  customerGroups: Row[];
  productGroups: Row[];
  units: Row[];
  journals: Row[];
  accounts: Row[];
  vatAccounts: Row[];
  customers: Row[];
  products: Row[];
  booked: Row[];
  drafts: Row[];
  draftLines: Row[];
  entries: Row[];
  webhooks: Row[];
  /** Zones whose drafts get amounts incl. VAT (Q2C `isVatIncluded`). */
  vatIncludedZones?: number[];
  /** Answers a request with an error instead: `{ 'POST /invoices/booked': { status, body } }`. */
  errors?: Record<string, { status: number; body: unknown; once?: boolean }>;
}

export interface EcoRequest {
  family: 'rest' | 'q2c' | 'journals' | 'webhooks';
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Row | null;
}

const unescape = (v: string) => v.replace(/\$(.)/g, '$1');

/** Reads a dotted path ("customer.customerNumber") from a row. */
const at = (row: Row, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Row)[k] : undefined), row);

export function applyFilter(rows: Row[], filter: string | null): Row[] {
  if (!filter) return rows;
  const parts = filter.split('$and:');
  return rows.filter((row) =>
    parts.every((p) => {
      const m = /^([\w.]+)\$(eq|gte|gt|in|like):(.*)$/.exec(p);
      if (!m) throw new Error(`fake e-conomic: filter ${p}`);
      const [, field, op, raw] = m as unknown as [string, string, string, string];
      const v = at(row, field!);
      const value = unescape(raw!);
      if (op === 'eq')
        return typeof v === 'number'
          ? v === Number(value)
          : typeof v === 'boolean'
            ? v === (value === 'true')
            : String(v ?? '').toLowerCase() === value.toLowerCase();
      if (op === 'gte') return String(v ?? '') >= value;
      if (op === 'gt') return String(v ?? '') > value;
      if (op === 'in')
        return value
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(Number)
          .includes(Number(v));
      return String(v ?? '')
        .toLowerCase()
        .includes(value.replace(/\*/g, '').toLowerCase());
    }),
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fakeEconomic(db: FakeEconomic): { transport: Transport; sent: EcoRequest[] } {
  const sent: EcoRequest[] = [];
  let next = 1000;

  const page = (rows: Row[], q: URLSearchParams) => {
    const size = Number(q.get('pagesize') ?? 20);
    const skip = Number(q.get('skippages') ?? 0);
    let list = applyFilter(rows, q.get('filter'));
    const sort = q.get('sort');
    if (sort === '-bookedInvoiceNumber')
      list = [...list].sort(
        (a, b) => Number(b.bookedInvoiceNumber) - Number(a.bookedInvoiceNumber),
      );
    const slice = list.slice(skip * size, skip * size + size);
    return {
      collection: slice,
      pagination: {
        results: list.length,
        ...((skip + 1) * size < list.length ? { nextPage: `next-${skip + 1}` } : {}),
      },
    };
  };

  /** Draft totals as e-conomic computes them: 25 % VAT in zone 1 on groups with VAT. */
  const totals = (d: Row) => {
    const lines = db.draftLines.filter((l) => l.documentId === d.number);
    let net = 0;
    let vat = 0;
    for (const l of lines) {
      const amount =
        Number(l.quantity) * Number(l.unitNetPrice) * (1 - Number(l.discountPercentage ?? 0) / 100);
      const product = db.products.find((p) => p.productNumber === l.productNumber);
      const group = Number((product?.productGroup as Row | undefined)?.productGroupNumber ?? 1);
      const rate = d.vatZoneNumber === 1 && group === 1 ? 0.25 : 0;
      if (d.isVatIncluded) {
        net += amount / (1 + rate);
        vat += amount - amount / (1 + rate);
      } else {
        net += amount;
        vat += amount * rate;
      }
    }
    return { amount: round2(net), vatAmount: round2(vat), roundingAmount: 0 };
  };

  const draftView = (d: Row) => ({ ...d, ...totals(d) });

  const handle = (r: EcoRequest): { status: number; json?: unknown } => {
    const key = `${r.method} ${r.path}`;
    const err = db.errors?.[key];
    if (err) {
      if (err.once) delete db.errors![key];
      return { status: err.status, json: err.body };
    }
    const b = r.body ?? {};
    if (r.family === 'rest') {
      const lists: Record<string, Row[]> = {
        '/layouts': db.layouts,
        '/vat-zones': db.vatZones,
        '/payment-terms': db.paymentTerms,
        '/customer-groups': db.customerGroups,
        '/product-groups': db.productGroups,
        '/units': db.units,
        '/journals': db.journals,
        '/accounts': db.accounts,
        '/vat-accounts': db.vatAccounts,
        '/customers': db.customers,
        '/products': db.products,
        '/invoices/booked': db.booked,
      };
      if (r.method === 'GET' && r.path === '/self') return { status: 200, json: db.self ?? {} };
      if (r.method === 'GET' && lists[r.path])
        return { status: 200, json: page(lists[r.path]!, r.query) };
      let m = /^\/customers\/(\d+)$/.exec(r.path);
      if (m) {
        const c = db.customers.find((x) => x.customerNumber === Number(m![1]));
        if (!c) return { status: 404, json: { message: 'Resource not found.' } };
        if (r.method === 'GET') return { status: 200, json: c };
        if (r.method === 'PUT') {
          for (const k of Object.keys(c)) delete c[k];
          Object.assign(c, b, { customerNumber: Number(m[1]) });
          return { status: 200, json: c };
        }
      }
      if (r.method === 'POST' && r.path === '/customers') {
        const n =
          typeof b.customerNumber === 'number'
            ? b.customerNumber
            : Math.max(0, ...db.customers.map((c) => Number(c.customerNumber))) + 1;
        const c = { ...b, customerNumber: n };
        db.customers.push(c);
        return { status: 201, json: c };
      }
      m = /^\/customers\/(\d+)\/contacts$/.exec(r.path);
      if (m && r.method === 'POST')
        return { status: 201, json: { ...b, customerContactNumber: 1 } };
      if (r.method === 'POST' && r.path === '/products') {
        db.products.push({ ...b });
        return { status: 201, json: b };
      }
      m = /^\/products\/(.+)$/.exec(r.path);
      if (m && r.method === 'PUT') {
        const p = db.products.find((x) => x.productNumber === decodeURIComponent(m![1]!));
        if (!p) return { status: 404, json: { message: 'Resource not found.' } };
        Object.assign(p, b);
        return { status: 200, json: p };
      }
      m = /^\/invoices\/booked\/(\d+)$/.exec(r.path);
      if (m && r.method === 'GET') {
        const inv = db.booked.find((x) => x.bookedInvoiceNumber === Number(m![1]));
        return inv
          ? { status: 200, json: inv }
          : { status: 404, json: { message: 'Resource not found.' } };
      }
      if (r.method === 'POST' && r.path === '/invoices/booked') {
        const dn = Number((b.draftInvoice as Row).draftInvoiceNumber);
        const d = db.drafts.find((x) => x.draftInvoiceNumber === dn);
        if (!d) return { status: 400, json: { message: 'Draft not found.' } };
        const t = totals(d);
        const number =
          typeof b.bookWithNumber === 'number'
            ? b.bookWithNumber
            : Math.max(0, ...db.booked.map((x) => Number(x.bookedInvoiceNumber))) + 1;
        const gross = round2(t.amount + t.vatAmount);
        const inv = {
          bookedInvoiceNumber: number,
          date: d.date,
          currency: d.currencyCode,
          grossAmount: gross,
          remainder: gross,
          customer: { customerNumber: d.customerNumber },
          recipient: { name: d.customerName, vatZone: { vatZoneNumber: d.vatZoneNumber } },
          references: { other: d.otherReference },
          sendBy: b.sendBy ?? 'none',
        };
        db.booked.push(inv);
        db.drafts.splice(db.drafts.indexOf(d), 1);
        return { status: 201, json: inv };
      }
    }
    if (r.family === 'q2c') {
      if (r.method === 'GET' && r.path === '/invoices/drafts')
        return { status: 200, json: { items: applyFilter(db.drafts, r.query.get('filter')) } };
      if (r.method === 'POST' && r.path === '/invoices/drafts') {
        const n = next++;
        const d = {
          ...b,
          number: n,
          draftInvoiceNumber: n - 900,
          isVatIncluded: (db.vatIncludedZones ?? []).includes(Number(b.vatZoneNumber)),
          objectVersion: 'v1',
        };
        db.drafts.push(d);
        return { status: 201, json: { number: n } };
      }
      let m = /^\/invoices\/drafts\/(\d+)$/.exec(r.path);
      if (m) {
        const d = db.drafts.find((x) => x.number === Number(m![1]));
        if (!d) return { status: 404, json: { title: 'Not Found' } };
        if (r.method === 'GET') return { status: 200, json: draftView(d) };
        if (r.method === 'PUT') {
          if (b.objectVersion !== d.objectVersion)
            return { status: 409, json: { title: 'Conflict' } };
          Object.assign(d, b, { objectVersion: `${d.objectVersion}+` });
          return { status: 204 };
        }
      }
      m = /^\/invoices\/drafts\/(\d+)\/lines$/.exec(r.path);
      if (m && r.method === 'GET')
        return { status: 200, json: db.draftLines.filter((l) => l.documentId === Number(m![1])) };
      m = /^\/invoices\/drafts\/(\d+)\/lines\/bulk$/.exec(r.path);
      if (m && r.method === 'POST') {
        const numbers: number[] = [];
        for (const l of (b.lines as Row[]) ?? []) {
          if (!l.productNumber) return { status: 400, json: { title: 'productNumber required' } };
          const n = next++;
          numbers.push(n);
          db.draftLines.push({ ...l, number: n, documentId: Number(m[1]) });
        }
        return { status: 201, json: { numbers } };
      }
      m = /^\/invoices\/drafts\/(\d+)\/lines\/(\d+)$/.exec(r.path);
      if (m && r.method === 'DELETE') {
        const i = db.draftLines.findIndex((l) => l.number === Number(m![2]));
        if (i >= 0) db.draftLines.splice(i, 1);
        return { status: 204 };
      }
    }
    if (r.family === 'journals') {
      if (r.method === 'POST' && r.path === '/draft-entries') {
        const n = next++;
        db.entries.push({
          ...b,
          entryNumber: n,
          voucherNumber: b.voucherNumber ?? 5000 + n,
          booked: false,
        });
        return { status: 201, json: { entryNumber: n } };
      }
      let m = /^\/draft-entries\/(\d+)$/.exec(r.path);
      if (m && r.method === 'GET') {
        const e = db.entries.find((x) => x.entryNumber === Number(m![1]));
        return e ? { status: 200, json: e } : { status: 404, json: { title: 'Not Found' } };
      }
      m = /^\/journals\/(\d+)\/bookdraftentries$/.exec(r.path);
      if (m && r.method === 'POST') {
        for (const n of (b.entryNumbers as number[]) ?? []) {
          const e = db.entries.find((x) => x.entryNumber === n);
          if (e) e.booked = true;
        }
        return { status: 204 };
      }
    }
    if (r.family === 'webhooks') {
      const m = /^\/webhooks\/([A-Z_]+)$/.exec(r.path);
      if (m && r.method === 'GET') {
        const w = db.webhooks.find((x) => x.eventType === m![1]);
        return w ? { status: 200, json: w } : { status: 404, json: { title: 'Not Found' } };
      }
      if (r.method === 'POST' && r.path === '/webhooks') {
        db.webhooks.push({ ...b, objectVersion: 'w1' });
        return { status: 201, json: { number: db.webhooks.length } };
      }
      if (r.method === 'PUT' && r.path === '/webhooks') {
        const w = db.webhooks.find((x) => x.eventType === b.eventType);
        if (!w) return { status: 404, json: { title: 'Not Found' } };
        Object.assign(w, b);
        return { status: 204 };
      }
    }
    return { status: 404, json: { message: `fake e-conomic: no route ${r.family} ${key}` } };
  };

  const transport: Transport = async (raw: string, req: HttpRequest) => {
    const url = new URL(raw);
    let family: EcoRequest['family'] = 'rest';
    let path = url.pathname;
    const api = /^\/(q2capi|journalsapi|webhooksapi)\/v[\d.]+(\/.*)$/.exec(path);
    if (url.hostname.startsWith('apis.')) {
      if (!api) return { status: 404, headers: {}, body: '{}' };
      family = api[1] === 'q2capi' ? 'q2c' : api[1] === 'journalsapi' ? 'journals' : 'webhooks';
      path = api[2]!;
    }
    const body = typeof req.body === 'string' && req.body ? (JSON.parse(req.body) as Row) : null;
    const r: EcoRequest = {
      family,
      method: req.method,
      path,
      query: url.searchParams,
      headers: req.headers ?? {},
      body,
    };
    sent.push(r);
    if (
      r.headers['x-appsecrettoken'] !== 'app-secret' ||
      r.headers['x-agreementgranttoken'] !== 'grant-ok'
    )
      return {
        status: 401,
        headers: {},
        body: JSON.stringify({
          message: 'Token does not correspond to a valid grant.',
          errorCode: 'E02250',
        }),
      };
    const out = handle(r);
    return {
      status: out.status,
      headers: {},
      body: out.json !== undefined ? JSON.stringify(out.json) : '',
    };
  };
  return { transport, sent };
}

/** A small Danish agreement: standard zones, two product groups, a payment journal. */
export function agreement(): FakeEconomic {
  return {
    self: {
      agreementNumber: 771204,
      company: { name: 'Nordlys Outlet ApS' },
      agreementType: { subscriptionPlanLevel: 'plus' },
      canSendElectronicInvoice: true,
      settings: { baseCurrency: 'DKK', defaultPaymentTerm: '1' },
    },
    layouts: [{ layoutNumber: 21, name: 'DK. std. m. bankoplys.' }],
    vatZones: [
      { vatZoneNumber: 1, name: 'Domestic', enabledForCustomer: true },
      { vatZoneNumber: 2, name: 'EU', enabledForCustomer: true },
      { vatZoneNumber: 3, name: 'Abroad', enabledForCustomer: true },
      { vatZoneNumber: 13, name: 'Germany', enabledForCustomer: true },
    ],
    paymentTerms: [
      { paymentTermsNumber: 1, name: 'Netto 8 dage', paymentTermsType: 'net', daysOfCredit: 8 },
      { paymentTermsNumber: 5, name: 'Betalt', paymentTermsType: 'paidInCash', daysOfCredit: 0 },
    ],
    customerGroups: [
      { customerGroupNumber: 1, name: 'Danske kunder' },
      { customerGroupNumber: 2, name: 'Udenlandske kunder' },
    ],
    productGroups: [
      { productGroupNumber: 1, name: 'Varer m/moms', inventoryEnabled: true },
      { productGroupNumber: 2, name: 'Varer u/moms', inventoryEnabled: false },
    ],
    units: [{ unitNumber: 1, name: 'stk.' }],
    journals: [
      { journalNumber: 1, name: 'Daglig' },
      {
        journalNumber: 2,
        name: 'Indbetalinger',
        settings: { entryTypeRestrictedTo: 'customerPayment' },
      },
    ],
    accounts: [
      { accountNumber: 1000, name: 'RESULTATOPGØRELSE', accountType: 'heading' },
      {
        accountNumber: 1010,
        name: 'Salg af varer',
        accountType: 'profitAndLoss',
        vatAccount: { vatCode: 'U25' },
      },
      {
        accountNumber: 1015,
        name: 'Salg EU',
        accountType: 'profitAndLoss',
        vatAccount: { vatCode: 'UEUV' },
      },
      {
        accountNumber: 1090,
        name: 'Fragt',
        accountType: 'profitAndLoss',
        vatAccount: { vatCode: 'U25' },
      },
      { accountNumber: 5820, name: 'Bank', accountType: 'status' },
      { accountNumber: 5830, name: 'QuickPay', accountType: 'status' },
    ],
    vatAccounts: [
      { vatCode: 'U25', name: 'Salgsmoms', ratePercentage: 25 },
      { vatCode: 'UEUV', name: 'EU-salg af varer', ratePercentage: 0 },
    ],
    customers: [
      {
        customerNumber: 1,
        name: 'Line Kjær',
        email: 'line.kjaer@example.dk',
        address: 'Søndergade 12',
        zip: '8000',
        city: 'Aarhus C',
        country: 'Danmark',
        currency: 'DKK',
        customerGroup: { customerGroupNumber: 1 },
        paymentTerms: { paymentTermsNumber: 1 },
        vatZone: { vatZoneNumber: 1 },
        lastUpdated: '2026-10-20T08:00:00Z',
        balance: 0,
      },
      {
        customerNumber: 2,
        name: 'Rad Werk GmbH',
        email: 'buchhaltung@radwerk.example',
        corporateIdentificationNumber: 'DE811234567',
        country: 'Germany',
        currency: 'EUR',
        customerGroup: { customerGroupNumber: 2 },
        paymentTerms: { paymentTermsNumber: 1 },
        vatZone: { vatZoneNumber: 2 },
        lastUpdated: '2026-10-22T08:00:00Z',
      },
    ],
    products: [
      {
        productNumber: 'E7-M',
        name: 'Elcykel Nordlys E7',
        salesPrice: 15196,
        barCode: '5700000000010',
        barred: false,
        productGroup: { productGroupNumber: 1, name: 'Varer m/moms' },
        inventory: { available: 4, inStock: 6 },
        lastUpdated: '2026-10-21T10:00:00Z',
      },
      {
        productNumber: 'WEB',
        name: 'Webshopvare',
        salesPrice: 0,
        barred: false,
        productGroup: { productGroupNumber: 1, name: 'Varer m/moms' },
        inventory: { available: 0, inStock: 0 },
      },
      {
        productNumber: 'FRAGT',
        name: 'Fragt',
        salesPrice: 0,
        barred: false,
        productGroup: { productGroupNumber: 1, name: 'Varer m/moms' },
      },
      {
        productNumber: 'ORE',
        name: 'Øreafrunding',
        salesPrice: 0,
        barred: false,
        productGroup: { productGroupNumber: 2, name: 'Varer u/moms' },
      },
    ],
    booked: [],
    drafts: [],
    draftLines: [],
    entries: [],
    webhooks: [],
  };
}
