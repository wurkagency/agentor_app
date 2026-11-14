import { describe, expect, it } from 'vitest';
import { WriteError, type CreditNote, type Order, type WriteOptions } from '../src/index.js';
import {
  DineroAdapter,
  dineroAuthorizeUrl,
  dineroDate,
  openAdapter,
  uuidV5,
  vismaToken,
} from '../src/live/index.js';
import { fakeTransport, type FakeRoute } from './fake-http.js';

/** Dinero live client against a recorded API (PLAN-INTEGRATIONS-WOO-DINERO P2). */

const ORG = '412983';
const NOW = Date.parse('2026-10-25T12:00:00Z');

const order: Order = {
  sourceId: '1001',
  number: '1001',
  createdAt: '2026-10-18T22:30:00.000Z',
  paidAt: '2026-10-18T22:31:00.000Z',
  status: 'processing',
  currency: 'DKK',
  customer: {
    sourceId: '7',
    kind: 'person',
    name: 'Line Kjær',
    email: 'line.kjaer@example.dk',
    phone: null,
    vatNumber: null,
    address: { line1: 'Søndergade 12', postalCode: '8000', city: 'Aarhus C', country: 'DK' },
  },
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
  patch: Partial<NonNullable<WriteOptions['route']>> = {},
): NonNullable<WriteOptions['route']> => ({
  settings: {
    'invoice.language': 'da',
    'payment.register': true,
    'invoice.updateDrafts': true,
    'rounding.maxDiff': 1,
    'contact.match': 'email',
  },
  mapping: {},
  tables: { paymentMethods: [{ from: 'quickpay', account: '55100' }] },
  accounts: ['1000', '1000'],
  ...patch,
});

interface State {
  invoices: Record<
    string,
    {
      Guid: string;
      Status: string;
      TimeStamp: string;
      ExternalReference: string;
      ProductLines?: { AccountNumber: number; Description: string }[];
    }
  >;
  contacts: Record<
    string,
    { ContactGuid: string; Email: string; Name: string; ExternalReference?: string }
  >;
  staleOnce?: boolean;
  total?: number;
}

function dinero(state: State = { invoices: {}, contacts: {} }, extra: FakeRoute[] = []) {
  const byRef = (ref: string) =>
    Object.values(state.invoices).find((i) => i.ExternalReference === ref);
  const routes: FakeRoute[] = [
    ...extra,
    {
      method: 'POST',
      path: /^\/connect\/token$/,
      reply: () => ({ json: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 } }),
    },
    {
      method: 'GET',
      path: /^\/v1\.1\/organizations$/,
      reply: () => ({
        json: [
          { Id: 1, Name: 'Gammel ApS', Subscription: { HasPro: false } },
          { Id: Number(ORG), Name: 'Nordlys Cykler', Subscription: { HasPro: true } },
        ],
      }),
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/accounts\/entry$/,
      reply: () => ({
        json: [
          { AccountNumber: 1000, Name: 'Salg af varer/ydelser m. moms', VatCode: 'U25' },
          { AccountNumber: 1100, Name: 'EU-leverancer varer', VatCode: 'UEUV' },
          { AccountNumber: 1999, Name: 'Skjult', VatCode: null, IsHidden: true },
        ],
      }),
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/contacts$/,
      reply: (_m, url) => {
        const f = url.searchParams.get('queryFilter') ?? '';
        const email = /Email eq '(.+)'/.exec(f)?.[1];
        const ext = /ExternalReference eq '(.+)'/.exec(f)?.[1];
        const hit = Object.values(state.contacts).find(
          (c) => (email && c.Email === email) || (ext && c.ExternalReference === ext),
        );
        return { json: { Collection: hit ? [hit] : [] } };
      },
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/contacts\/([\w-]+)$/,
      reply: (m) => ({
        json: { ...state.contacts[m[1]!], Phone: '+4511111111', Webpage: 'https://x' },
      }),
    },
    { method: 'PUT', path: /^\/v2\/\d+\/contacts\/([\w-]+)$/, reply: () => ({ json: {} }) },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/contacts$/,
      reply: (_m, _u, req) => ({ json: { ContactGuid: JSON.parse(String(req.body)).ContactGuid } }),
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/invoices\/fetch$/,
      reply: () => ({ json: { TotalInclVat: state.total ?? 17144.5 } }),
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/invoices$/,
      reply: (_m, url) => {
        const ext =
          /ExternalReference eq '(.+)'/.exec(url.searchParams.get('queryFilter') ?? '')?.[1] ?? '';
        const hit = byRef(ext);
        return { json: { Collection: hit ? [{ Guid: hit.Guid, Status: hit.Status }] : [] } };
      },
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/invoices\/([\w-]+)$/,
      reply: (m) =>
        state.invoices[m[1]!] ? { json: state.invoices[m[1]!] } : { status: 404, json: {} },
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/invoices$/,
      reply: (_m, _u, req) => {
        const b = JSON.parse(String(req.body));
        state.invoices[b.Guid] = {
          Guid: b.Guid,
          Status: 'Draft',
          TimeStamp: 'T1',
          ExternalReference: b.ExternalReference,
        };
        return { json: { Guid: b.Guid, TimeStamp: 'T1' } };
      },
    },
    {
      method: 'PUT',
      path: /^\/v1\.2\/\d+\/invoices\/([\w-]+)$/,
      reply: (m, _u, req) => {
        if (state.staleOnce && JSON.parse(String(req.body)).Timestamp !== 'T9') {
          state.staleOnce = false;
          state.invoices[m[1]!]!.TimeStamp = 'T9';
          return {
            status: 400,
            json: { code: 58, message: 'Timestamp is not the latest version' },
          };
        }
        return { json: { TimeStamp: 'T2' } };
      },
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/invoices\/([\w-]+)\/book$/,
      reply: (m) => {
        state.invoices[m[1]!]!.Status = 'Booked';
        return { json: { Guid: m[1], Status: 'Booked', TimeStamp: 'T3', Number: 1042 } };
      },
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/invoices\/[\w-]+\/payments$/,
      reply: () => ({ json: { TimeStamp: 'T4' } }),
    },
    {
      method: 'GET',
      path: /^\/v1\/\d+\/sales\/creditnotes$/,
      reply: () => ({ json: { Collection: [] } }),
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/sales\/creditnotes$/,
      reply: (_m, _u, req) => ({
        json: { Guid: JSON.parse(String(req.body)).Guid, TimeStamp: 'C1' },
      }),
    },
    {
      method: 'POST',
      path: /^\/v1\/\d+\/sales\/creditnotes\/[\w-]+\/book$/,
      reply: () => ({ json: {} }),
    },
  ];
  return fakeTransport(routes);
}

function adapter(
  t = dinero(),
  creds: Record<string, string> = {},
  persisted: Record<string, string>[] = [],
  settings: Record<string, unknown> = { organizationId: ORG },
) {
  return new DineroAdapter({
    connectorId: 'dinero',
    mode: 'live',
    credentials: {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: '2026-10-25T13:00:00.000Z',
      ...creds,
    },
    settings,
    persist: async (p) => void persisted.push(p),
    oauth: {
      clientId: 'isv_Agentor',
      clientSecret: 'secret',
      connectUrl: 'https://connect.example',
    },
    transport: t.transport,
    now: () => NOW,
  });
}

const sentTo = (t: ReturnType<typeof dinero>, method: string, path: RegExp) =>
  t.sent.filter((s) => s.method === method && path.test(s.url.pathname));

describe('Visma Connect', () => {
  it('builds the authorize URL with the Dinero scopes', () => {
    const u = new URL(
      dineroAuthorizeUrl({
        clientId: 'isv_Agentor',
        redirectUri: 'https://app.example/connect/dinero/callback',
        state: 's1',
      }),
    );
    expect(u.origin + u.pathname).toBe('https://connect.visma.com/connect/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'isv_Agentor',
      response_type: 'code',
      scope: 'dineropublicapi:read dineropublicapi:write offline_access',
      state: 's1',
      ui_locales: 'da-DK',
    });
  });

  it('exchanges a code with a form-encoded body', async () => {
    const t = dinero();
    const tokens = await vismaToken(
      { clientId: 'c', clientSecret: 's', connectUrl: 'https://connect.example' },
      { grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://app.example/cb' },
      t.transport,
      NOW,
    );
    expect(tokens).toEqual({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      expiresAt: '2026-10-25T13:00:00.000Z',
    });
    expect(t.sent[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(t.sent[0]!.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: 'https://app.example/cb',
      client_id: 'c',
      client_secret: 's',
    });
  });

  it('refreshes an expiring token first and stores the new pair', async () => {
    const t = dinero();
    const persisted: Record<string, string>[] = [];
    await adapter(t, { expiresAt: '2026-10-25T12:00:30.000Z' }, persisted).lookup('accounts');
    expect(t.sent[0]!.url.pathname).toBe('/connect/token');
    expect(t.sent[1]!.headers.authorization).toBe('Bearer at-2');
    expect(persisted).toEqual([
      { accessToken: 'at-2', refreshToken: 'rt-2', expiresAt: '2026-10-25T13:00:00.000Z' },
    ]);
  });
});

describe('connection', () => {
  it('picks the first licensed company and remembers it', async () => {
    const persisted: Record<string, string>[] = [];
    expect(await adapter(dinero(), {}, persisted, {}).test()).toEqual({
      ok: true,
      account: { id: ORG, name: 'Nordlys Cykler' },
    });
    expect(persisted).toEqual([{ organizationId: ORG }]);
  });

  it('refuses a company without Pro and one the user lost', async () => {
    expect(await adapter(dinero(), {}, [], { organizationId: '1' }).test()).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      message: expect.stringMatching(/Pro/),
    });
    expect(await adapter(dinero(), {}, [], { organizationId: '777' }).test()).toMatchObject({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('lists accounts with their VAT codes, without hidden ones', async () => {
    expect(await adapter().lookup('accounts')).toEqual([
      { value: '1000', label: 'Salg af varer/ydelser m. moms', vatCode: 'U25' },
      { value: '1100', label: 'EU-leverancer varer', vatCode: 'UEUV' },
    ]);
  });

  it('needs tokens to open', () => {
    expect(() => openAdapter({ connectorId: 'dinero', mode: 'live', credentials: {} })).toThrow(
      /incomplete/,
    );
  });
});

describe('contacts', () => {
  it('finds a contact by e-mail and updates it without losing fields it does not own', async () => {
    const t = dinero({
      invoices: {},
      contacts: { 'c-1': { ContactGuid: 'c-1', Email: 'line.kjaer@example.dk', Name: 'Line K' } },
    });
    const res = await adapter(t).write('customer', order.customer, {
      mode: 'live',
      route: route(),
      fields: { 'contact.externalReference': 'agentor:woo:7' },
    });
    expect(res).toEqual({ action: 'update', destinationId: 'c-1' });
    const put = sentTo(t, 'PUT', /contacts/)[0]!;
    expect(put.url.pathname).toBe(`/v2/${ORG}/contacts/c-1`);
    expect(put.body).toMatchObject({
      Name: 'Line Kjær',
      Webpage: 'https://x',
      IsPerson: true,
      VatNumber: null,
    });
  });

  it('creates a contact with a Guid derived from its reference', async () => {
    const t = dinero();
    const res = await adapter(t).write('customer', order.customer, {
      mode: 'live',
      route: route(),
      fields: { 'contact.externalReference': 'agentor:woo:7' },
    });
    expect(res).toEqual({
      action: 'create',
      destinationId: uuidV5(`contact:${ORG}:agentor:woo:7`),
    });
    expect(sentTo(t, 'POST', /contacts$/)[0]!.body).toMatchObject({
      ExternalReference: 'agentor:woo:7',
      CountryKey: 'DK',
      PaymentConditionNumberOfDays: 8,
    });
  });
});

describe('invoices', () => {
  const opts = (mode: WriteOptions['mode'], patch: Partial<WriteOptions> = {}): WriteOptions => ({
    mode,
    refs: { 'customer:7': 'c-1' },
    fields: {
      'invoice.externalReference': 'agentor:woo:1001',
      'invoice.description': 'Ordre 1001',
    },
    lineFields: [{ 'line.description': 'Elcykel Nordlys E7 (E7-M)' }],
    route: route(),
    ...patch,
  });

  it('creates a draft with the engine’s accounts, line discount and shipping', async () => {
    const t = dinero();
    const res = await adapter(t).write('order', order, opts('draft'));
    const guid = uuidV5(`invoice:${ORG}:agentor:woo:1001`);
    expect(res).toEqual({ action: 'create', destinationId: guid });
    expect(sentTo(t, 'POST', /invoices$/)[0]!.body).toEqual({
      ContactGuid: 'c-1',
      Guid: guid,
      Date: '2026-10-19',
      Currency: 'DKK',
      Language: 'da-DK',
      ExternalReference: 'agentor:woo:1001',
      Description: 'Ordre 1001',
      Comment: null,
      ShowLinesInclVat: false,
      PaymentConditionType: 'Paid',
      PaymentConditionNumberOfDays: null,
      ProductLines: [
        {
          Description: 'Elcykel Nordlys E7 (E7-M)',
          Quantity: 1,
          AccountNumber: 1000,
          Unit: 'parts',
          Discount: 10,
          LineType: 'Product',
          BaseAmountValue: 15196,
        },
        {
          Description: 'GLS Pakkeshop',
          Quantity: 1,
          AccountNumber: 1000,
          Unit: 'parts',
          Discount: 0,
          LineType: 'Product',
          BaseAmountValue: 39.2,
        },
      ],
    });
    expect(sentTo(t, 'POST', /book$/)).toHaveLength(0);
  });

  it('books live invoices and registers the payment on the method’s account', async () => {
    const t = dinero();
    await adapter(t).write('order', order, opts('live'));
    expect(sentTo(t, 'POST', /book$/)[0]!.body).toEqual({ Timestamp: 'T1' });
    expect(sentTo(t, 'POST', /payments$/)[0]!.body).toEqual({
      Timestamp: 'T3',
      DepositAccountNumber: 55100,
      Amount: 17144.5,
      RemainderIsFee: false,
      ExternalReference: 'qp-778',
      PaymentDate: '2026-10-19',
      Description: 'Kort',
    });
  });

  it('never changes a booked invoice, and updates a draft with a fresh Timestamp', async () => {
    const guid = uuidV5(`invoice:${ORG}:agentor:woo:1001`);
    const booked = dinero({
      invoices: {
        [guid]: {
          Guid: guid,
          Status: 'Booked',
          TimeStamp: 'T5',
          ExternalReference: 'agentor:woo:1001',
        },
      },
      contacts: {},
    });
    expect(await adapter(booked).write('order', order, opts('live'))).toEqual({
      action: 'skip',
      destinationId: guid,
    });
    expect(sentTo(booked, 'POST', /invoices$/)).toHaveLength(0);

    const draft = dinero({
      invoices: {
        [guid]: {
          Guid: guid,
          Status: 'Draft',
          TimeStamp: 'T5',
          ExternalReference: 'agentor:woo:1001',
        },
      },
      contacts: {},
      staleOnce: true,
    });
    expect(await adapter(draft).write('order', order, opts('draft'))).toEqual({
      action: 'update',
      destinationId: guid,
    });
    const puts = sentTo(draft, 'PUT', /invoices/);
    // Error 58 (stale Timestamp): read it again and retry once.
    expect(puts.map((p) => (p.body as { Timestamp: string }).Timestamp)).toEqual(['T5', 'T9']);
  });

  it('stops on a total that differs more than allowed, and fails a line without account', async () => {
    await expect(
      adapter(dinero({ invoices: {}, contacts: {}, total: 17150 })).write(
        'order',
        order,
        opts('draft'),
      ),
    ).rejects.toMatchObject({ kind: 'invalid', message: expect.stringMatching(/differs/) });
    const t = dinero({ invoices: {}, contacts: {}, total: 17144.2 });
    await adapter(t).write(
      'order',
      order,
      opts('draft', { route: route({ mapping: { 'accounts.rounding': '3690' } }) }),
    );
    expect(
      (sentTo(t, 'POST', /invoices$/)[0]!.body as { ProductLines: unknown[] }).ProductLines.at(-1),
    ).toMatchObject({ Description: 'Øreafrunding', AccountNumber: 3690, BaseAmountValue: 0.3 });
    await expect(
      adapter().write('order', order, opts('draft', { route: route({ accounts: [null] }) })),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('writes nothing on a dry run', async () => {
    const t = dinero();
    expect(await adapter(t).write('order', order, opts('dry_run'))).toEqual({
      action: 'create',
      destinationId: null,
    });
    expect(t.sent.filter((s) => s.method !== 'GET' && !/fetch$/.test(s.url.pathname))).toHaveLength(
      0,
    );
  });
});

describe('credit notes', () => {
  const cn: CreditNote = {
    sourceId: '901',
    number: '901',
    orderSourceId: '1001',
    createdAt: '2026-10-19T09:00:00.000Z',
    currency: 'DKK',
    customer: order.customer,
    lines: [
      {
        sku: null,
        productId: null,
        name: 'Ridse i lakken',
        quantity: 1,
        unitPrice: 40000,
        vatRate: 0.25,
        category: null,
      },
    ],
    total: 50000,
  };
  const opts: WriteOptions = {
    mode: 'live',
    refs: { 'customer:7': 'c-1' },
    fields: {
      'creditNote.externalReference': 'agentor:woo:901',
      'creditNote.invoiceReference': 'agentor:woo:1001',
    },
    route: route(),
  };

  it('credits the booked invoice on its own accounts', async () => {
    const t = dinero({
      invoices: {
        'inv-1': {
          Guid: 'inv-1',
          Status: 'Booked',
          TimeStamp: 'T5',
          ExternalReference: 'agentor:woo:1001',
          ProductLines: [{ AccountNumber: 1020, Description: 'Elcykel' }],
        },
      },
      contacts: {},
    });
    const res = await adapter(t).write('creditNote', cn, opts);
    expect(res.action).toBe('create');
    expect(sentTo(t, 'POST', /creditnotes$/)[0]!.body).toMatchObject({
      CreditNoteFor: 'inv-1',
      ContactGuid: 'c-1',
      ProductLines: [{ Description: 'Ridse i lakken', AccountNumber: 1020, BaseAmountValue: 400 }],
    });
    expect(sentTo(t, 'POST', /creditnotes\/.+\/book$/)).toHaveLength(1);
  });

  it('needs the invoice booked in Dinero first', async () => {
    const t = dinero({
      invoices: {
        'inv-1': {
          Guid: 'inv-1',
          Status: 'Draft',
          TimeStamp: 'T5',
          ExternalReference: 'agentor:woo:1001',
        },
      },
      contacts: {},
    });
    await expect(adapter(t).write('creditNote', cn, opts)).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringMatching(/draft/),
    });
    await expect(adapter(dinero()).write('creditNote', cn, opts)).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringMatching(/not in Dinero/),
    });
  });
});

describe('errors', () => {
  const failing = (status: number, body: unknown) =>
    dinero({ invoices: {}, contacts: {} }, [
      { method: 'POST', path: /fetch$/, reply: () => ({ status, json: body }) },
    ]);
  const write = (t: ReturnType<typeof dinero>) =>
    adapter(t).write('order', order, {
      mode: 'draft',
      route: route(),
      refs: { 'customer:7': 'c-1' },
    });

  it('maps rate limits, brownouts, licences and rejected data to the engine classes', async () => {
    await expect(write(failing(429, 'API calls quota exceeded!'))).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 60_000,
    });
    await expect(write(failing(480, {}))).rejects.toMatchObject({ kind: 'transient' });
    await expect(write(failing(403, { code: 90 }))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(write(failing(400, { code: 42, message: 'Validation' }))).rejects.toBeInstanceOf(
      WriteError,
    );
    await expect(write(failing(400, { code: 42 }))).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('formats dates in Danish time', () => {
    expect(dineroDate('2026-10-18T22:30:00Z')).toBe('2026-10-19');
  });
});
