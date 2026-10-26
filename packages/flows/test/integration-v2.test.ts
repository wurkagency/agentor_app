import {
  adapterFor,
  DINERO_ACCOUNTS,
  MOCK_ORDERS,
  type ConnectorAdapter,
  type Order,
  type WriteOptions,
} from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import {
  diffDefinitions,
  parseDefinition,
  planInvoice,
  runRoute,
  validateDefinition,
  type Route,
} from '../src/index.js';

/** P0 of PLAN-INTEGRATIONS-WOO-DINERO: v2 accounts, source options, templates and checks. */

const WOO = '0190b000-0000-7000-8000-000000000301';
const DINERO = '0190b000-0000-7000-8000-000000000303';

const ACCOUNTS = {
  'accounts.domestic': '1000',
  'accounts.vatFree': '1050',
  'accounts.euB2b': '1015',
  'accounts.export': '1040',
  'accounts.shipping': '1100',
  'accounts.shippingVatFree': '1110',
};

const def = parseDefinition({
  nodes: [
    { id: 'src', role: 'source', connectionId: WOO },
    { id: 'dinero', role: 'destination', connectionId: DINERO },
  ],
  routes: [
    {
      id: 'orders-dinero',
      from: 'src',
      to: 'dinero',
      entity: 'order',
      targetEntity: 'order',
      mode: 'draft',
      mapping: ACCOUNTS,
    },
  ],
});
const route = def.routes[0]!;

const ctx = {
  connections: {
    [WOO]: { connectorId: 'woocommerce', status: 'ok' as const, name: 'nordlys-cykler.dk' },
    [DINERO]: { connectorId: 'dinero', status: 'ok' as const, name: 'Nordlys Cykler' },
  },
  lookups: { [DINERO]: { accounts: DINERO_ACCOUNTS } },
  maxDestinations: 3,
};

const withRoute = (patch: Partial<Route>) => ({ ...def, routes: [{ ...route, ...patch }] });

const order = (patch: Partial<Order>, country = 'DK', vatNumber: string | null = null): Order => {
  const base = MOCK_ORDERS[1]!;
  return {
    ...base,
    ...patch,
    customer: { ...base.customer, vatNumber, address: { ...base.customer.address, country } },
  };
};

/** A Dinero mock that records what the engine passes to write(). */
function recording(): { adapter: ConnectorAdapter; seen: WriteOptions[] } {
  const base = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
  const seen: WriteOptions[] = [];
  return {
    seen,
    adapter: {
      ...base,
      connectorId: base.connectorId,
      write: async (entity, record, opts) => {
        seen.push(opts);
        return base.write(entity, record, opts);
      },
    } as ConnectorAdapter,
  };
}

describe('accounts v2 (PLAN F8, D3)', () => {
  const eu = (vatRate: number, supplyType?: 'goods' | 'services') =>
    order(
      { lines: [{ ...MOCK_ORDERS[1]!.lines[0]!, vatRate, ...(supplyType ? { supplyType } : {}) }] },
      'DE',
      vatRate ? null : 'DE811000001',
    );

  it('books EU B2B services on their own account, falling back to the goods account', () => {
    const goods = planInvoice(route, eu(0), DINERO_ACCOUNTS);
    expect(goods.lines[0]!.account).toBe('1015');
    const fallback = planInvoice(route, eu(0, 'services'), DINERO_ACCOUNTS);
    expect(fallback.lines[0]!.account).toBe('1015');
    const own = planInvoice(
      { ...route, mapping: { ...ACCOUNTS, 'accounts.euB2bServices': '1030' } },
      eu(0, 'services'),
      DINERO_ACCOUNTS,
    );
    expect(own.lines[0]!.account).toBe('1030');
  });

  it('books EU private sales with Danish VAT like domestic sales, with category rows', () => {
    const r = { ...route, categoryAccounts: [{ category: 'Cykler', account: '1020' }] };
    expect(planInvoice(r, eu(0.25), DINERO_ACCOUNTS).lines[0]!.account).toBe('1020');
    const own = { ...route, mapping: { ...ACCOUNTS, 'accounts.euB2c': '1030' } };
    expect(planInvoice(own, eu(0.25), DINERO_ACCOUNTS).lines[0]!.account).toBe('1030');
  });

  it('needs its own account under OSS and warns about foreign VAT', () => {
    const oss = { ...route, settings: { 'oss.mode': 'destinationVat' } };
    const plan = planInvoice(oss, eu(0.19), DINERO_ACCOUNTS);
    expect(plan.missing).toEqual({ key: 'accounts.euB2c', value: null });
    expect(plan.warnings).toEqual([
      { code: 'VAT_FOREIGN', params: { line: 'Elcykel Nordlys E7', rate: '19', kind: 'euB2c' } },
    ]);
    const f = validateDefinition(withRoute({ settings: { 'oss.mode': 'destinationVat' } }), ctx);
    expect(f.find((x) => x.code === 'MAPPING_REQUIRED')?.path).toBe('mapping.accounts.euB2c');
    expect(validateDefinition(def, ctx).some((x) => x.code === 'MAPPING_REQUIRED')).toBe(false);
  });

  it("warns when an account's VAT code fits another kind of sale", () => {
    const lookups = {
      [DINERO]: {
        accounts: DINERO_ACCOUNTS.map((a) =>
          a.value === '1015'
            ? { ...a, vatCode: 'U25' }
            : a.value === '1000'
              ? { ...a, vatCode: 'U25' }
              : a,
        ),
      },
    };
    const f = validateDefinition(def, { ...ctx, lookups });
    expect(f.filter((x) => x.code === 'ACCOUNT_VAT_MISMATCH')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        path: 'mapping.accounts.euB2b',
        params: expect.objectContaining({ value: '1015', vatCode: 'U25', expected: 'UEUV, UEUY' }),
      }),
    ]);
  });
});

describe('source options (PLAN §4.3)', () => {
  it('sends only the chosen order statuses, and all when none are chosen', async () => {
    const records = [
      order({ sourceId: 'a', status: 'processing' }),
      order({ sourceId: 'b', status: 'cancelled' }),
    ];
    const run = (r: Route) =>
      runRoute({
        def,
        route: r,
        records,
        destination: recording().adapter,
        dryRun: true,
        existingId: () => null,
      });
    expect((await run(route)).map((r) => r.outcome)).toEqual(['would_create', 'would_create']);
    const only = await run({ ...route, sourceOptions: { 'trigger.statuses': ['processing'] } });
    expect(only.map((r) => [r.outcome, r.skipReason])).toEqual([
      ['would_create', null],
      ['skipped', 'status:cancelled'],
    ]);
  });

  it('matches custom shop statuses and skips 0 kr. orders when asked', async () => {
    const records = [
      order({ sourceId: 'a', status: 'pending', sourceStatus: 'awaiting-shipment' }),
      order({ sourceId: 'z', total: 0 }),
    ];
    const res = await runRoute({
      def,
      route: {
        ...route,
        sourceOptions: {
          'trigger.statuses': ['awaiting-shipment', 'completed'],
          skipZeroTotal: true,
        },
      },
      records,
      destination: recording().adapter,
      dryRun: true,
      existingId: () => null,
    });
    expect(res.map((r) => [r.outcome, r.skipReason])).toEqual([
      ['would_create', null],
      ['skipped', 'zeroTotal'],
    ]);
  });
});

describe('templates (PLAN §5.5)', () => {
  it('renders the Dinero fields from defaults and route templates and passes them to write', async () => {
    const { adapter, seen } = recording();
    const [res] = await runRoute({
      def,
      route: {
        ...route,
        templates: {
          'invoice.description': 'Webshop {order.number} · {order.customer.name}',
          'line.description': '{line.name} ({line.sku})',
        },
      },
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      accounts: DINERO_ACCOUNTS,
      dryRun: false,
      existingId: () => null,
    });
    expect(res!.outcome).toBe('created');
    expect(seen[0]!.fields).toEqual({
      'invoice.externalReference': `agentor:${WOO}:o-10446`,
      'invoice.description': 'Webshop 10446 · Line Kjær',
    });
    expect(seen[0]!.lineFields).toEqual([{ 'line.description': 'Elcykel Nordlys E7 (E7-M)' }]);
    expect(res!.preview!.fields!['invoice.description']).toBe('Webshop 10446 · Line Kjær');
  });

  it('fails the record with TEMPLATE_ERROR when a template cannot render', async () => {
    const [res] = await runRoute({
      def,
      route: { ...route, templates: { 'invoice.description': 'Ordre {order.number' } },
      records: [MOCK_ORDERS[1]!],
      destination: recording().adapter,
      accounts: DINERO_ACCOUNTS,
      dryRun: true,
      existingId: () => null,
    });
    expect(res).toMatchObject({
      outcome: 'failed',
      errorCode: 'TEMPLATE_ERROR',
      errorParams: { field: 'invoice.description' },
      failure: 'mapping',
    });
  });

  it('validates templates against the targets and the source variables', () => {
    const codes = (templates: Record<string, string>) =>
      validateDefinition(withRoute({ templates }), ctx)
        .filter((f) => f.code.startsWith('TEMPLATE'))
        .map((f) => [f.code, f.params?.variable ?? null]);
    expect(
      codes({ 'invoice.description': 'Ordre {order.number} {order.meta.ean} {connection.id}' }),
    ).toEqual([]);
    expect(codes({ 'invoice.description': 'Ordre {order.nummer}' })).toEqual([
      ['TEMPLATE_UNKNOWN_VARIABLE', 'order.nummer'],
    ]);
    // Line variables only exist in line fields.
    expect(codes({ 'invoice.description': '{line.name}' })).toEqual([
      ['TEMPLATE_UNKNOWN_VARIABLE', 'line.name'],
    ]);
    expect(codes({ 'line.description': '{line.name} {order.number}' })).toEqual([]);
    expect(codes({ 'invoice.description': '{order.number' })).toEqual([['TEMPLATE_INVALID', null]]);
    // External references are the idempotency key: not open to templates.
    expect(codes({ 'invoice.externalReference': 'x' })).toEqual([['TEMPLATE_UNKNOWN_FIELD', null]]);
  });

  it('reports template and source option changes in the publish diff', () => {
    const next = withRoute({ templates: { 'invoice.description': 'Ordre {order.number}' } });
    expect(diffDefinitions(def, next)).toEqual([{ routeId: 'orders-dinero', kind: 'settings' }]);
    const opts = withRoute({ sourceOptions: { 'trigger.statuses': ['completed'] } });
    expect(diffDefinitions(def, opts)).toEqual([{ routeId: 'orders-dinero', kind: 'settings' }]);
  });

  it('rejects prototype keys in templates and options', () => {
    expect(() =>
      parseDefinition({ ...def, routes: [{ ...route, templates: { '__proto__.x': 'y' } }] }),
    ).toThrow();
    expect(() =>
      parseDefinition({ ...def, routes: [{ ...route, sourceOptions: { constructor: true } }] }),
    ).toThrow();
  });
});
