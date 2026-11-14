import { adapterFor, DINERO_ACCOUNTS, MOCK_ORDERS } from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import {
  diffDefinitions,
  flowMode,
  flowStatus,
  parseDefinition,
  routeStatus,
  runRoute,
  summarise,
  validateDefinition,
  type FlowDefinition,
} from '../src/index.js';

const WOO = '0190b000-0000-7000-8000-000000000301';
const DINERO = '0190b000-0000-7000-8000-000000000303';
const CRM_CONN = '0190b000-0000-7000-8000-000000000305';

const ACCOUNTS = {
  'accounts.domestic': '1000',
  'accounts.vatFree': '1050',
  'accounts.euB2b': '1010',
  'accounts.export': '1040',
  'accounts.shipping': '1100',
  'accounts.shippingVatFree': '1110',
};

const def: FlowDefinition = parseDefinition({
  nodes: [
    { id: 'src', role: 'source', connectionId: WOO },
    { id: 'dinero', role: 'destination', connectionId: DINERO },
    { id: 'hubspot', role: 'destination', connectionId: CRM_CONN },
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
      categoryAccounts: [{ category: 'Tøj', account: '1020' }],
      filters: [{ field: 'total', op: 'gt', value: 0 }],
    },
    {
      id: 'customers-hubspot',
      from: 'src',
      to: 'hubspot',
      entity: 'customer',
      targetEntity: 'customer',
      mode: 'test',
    },
  ],
});

const ctx = {
  connections: {
    [WOO]: { connectorId: 'woocommerce', status: 'ok' as const, name: 'nordlys-cykler.dk' },
    [DINERO]: { connectorId: 'dinero', status: 'ok' as const, name: 'Nordlys Cykler' },
    [CRM_CONN]: { connectorId: 'hubspot', status: 'ok' as const, name: 'Nordlys Cykler' },
  },
  lookups: { [DINERO]: { accounts: DINERO_ACCOUNTS } },
  maxDestinations: 3,
};

describe('validation (D3-Editor-Validering)', () => {
  it('flags the EU B2B account that no longer exists in Dinero, and the route still in Test', () => {
    const f = validateDefinition(def, ctx);
    expect(f.filter((x) => x.severity === 'error')).toEqual([
      expect.objectContaining({
        code: 'ACCOUNT_NOT_FOUND',
        routeId: 'orders-dinero',
        path: 'mapping.accounts.euB2b',
        params: expect.objectContaining({ value: '1010', field: 'EU B2B-salg' }),
      }),
    ]);
    expect(f.filter((x) => x.severity === 'warning').map((x) => x.code)).toEqual(['ROUTE_IN_TEST']);
  });

  it('is clean once 1015 is chosen', () => {
    const fixed = structuredClone(def);
    fixed.routes[0]!.mapping['accounts.euB2b'] = '1015';
    expect(validateDefinition(fixed, ctx).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('enforces the destination limit and broken connections', () => {
    const f = validateDefinition(def, {
      ...ctx,
      maxDestinations: 1,
      connections: {
        ...ctx.connections,
        [DINERO]: { ...ctx.connections[DINERO], status: 'broken' },
      },
    });
    expect(f.map((x) => x.code)).toEqual(
      expect.arrayContaining(['TOO_MANY_DESTINATIONS', 'CONNECTION_BROKEN']),
    );
  });
});

describe('test run (D5-Testkørsel)', () => {
  const dinero = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });

  it('with 1010: the three EU B2B orders fail, the 0 kr. order is skipped (D1-Problemer)', async () => {
    const res = await runRoute({
      def,
      route: def.routes[0]!,
      records: MOCK_ORDERS,
      destination: dinero,
      accounts: DINERO_ACCOUNTS,
      dryRun: true,
      existingId: () => null,
    });
    const r447 = res.find((r) => r.label === '#10447')!;
    expect(r447.outcome).toBe('failed');
    expect(r447.errorCode).toBe('ACCOUNT_NOT_FOUND');
    expect(res.find((r) => r.label === '#10444')!.outcome).toBe('skipped');
    expect(res.filter((r) => r.outcome === 'failed').map((r) => r.label)).toEqual([
      '#10447',
      '#10441',
      '#10439',
    ]);
    expect(summarise(res)).toMatchObject({ total: 10, created: 6, skipped: 1, failed: 3 });
  });

  it('with 1015: 9 would be created, 1 skipped, nothing written', async () => {
    const fixed = structuredClone(def.routes[0]!);
    fixed.mapping['accounts.euB2b'] = '1015';
    const res = await runRoute({
      def,
      route: fixed,
      records: MOCK_ORDERS,
      destination: dinero,
      accounts: DINERO_ACCOUNTS,
      dryRun: true,
      existingId: () => null,
    });
    expect(summarise(res)).toMatchObject({
      total: 10,
      created: 9,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(res.every((r) => r.destinationId === null)).toBe(true);
    const p = res.find((r) => r.label === '#10447')!.preview!;
    expect(p.customer).toBe('Hans Weber GmbH');
    expect(p.vatFree).toBe(true);
    expect(p.lines).toEqual([
      expect.objectContaining({
        description: 'Racercykel Aero',
        amount: 431600,
        account: '1015',
        accountLabel: 'Salg EU',
      }),
      expect.objectContaining({
        kind: 'shipping',
        amount: 7900,
        account: '1110',
        accountLabel: 'Fragt momsfri',
      }),
    ]);
    // Category rows apply to domestic sales: the helmet (Tøj) is booked on 1020.
    expect(res.find((r) => r.label === '#10445')!.preview!.lines[0]!.account).toBe('1020');
  });

  it('a live run writes drafts and links existing records for updates', async () => {
    const res = await runRoute({
      def,
      route: { ...def.routes[0]!, mapping: { ...ACCOUNTS, 'accounts.euB2b': '1015' } },
      records: MOCK_ORDERS.slice(0, 2),
      destination: dinero,
      accounts: DINERO_ACCOUNTS,
      dryRun: false,
      existingId: (id) => (id === 'o-10446' ? 'dinero-order-o-10446' : null),
    });
    expect(res.map((r) => r.outcome)).toEqual(['created', 'updated']);
  });
});

describe('status and mode', () => {
  const base = {
    published: true,
    flowPaused: false,
    brokenConnections: new Set<string>(),
    health: {},
    warnErrorRate: 0.05,
  };
  it('rolls up: open failures make the flow Fejl; a broken connection wins', () => {
    expect(routeStatus(def, def.routes[1]!, base)).toBe('info');
    expect(flowStatus(def, base)).toBe('ok');
    const failing = { ...base, health: { 'orders-dinero': { openFailures: 3, errorRate: 0.01 } } };
    expect(flowStatus(def, failing)).toBe('error');
    expect(flowStatus(def, { ...failing, brokenConnections: new Set([DINERO]) })).toBe('broken');
    expect(flowStatus(def, { ...base, published: false })).toBe('draft');
    expect(flowStatus(def, { ...base, flowPaused: true })).toBe('paused');
    expect(flowMode(def)).toBe('mixed');
  });

  it('lists what changed for the publish dialog', () => {
    const next = structuredClone(def);
    next.routes[0]!.mapping['accounts.euB2b'] = '1015';
    next.routes[1]!.mode = 'live';
    expect(diffDefinitions(def, next)).toEqual([
      {
        routeId: 'orders-dinero',
        kind: 'mapping',
        field: 'accounts.euB2b',
        before: '1010',
        after: '1015',
      },
      { routeId: 'customers-hubspot', kind: 'mode', before: 'test', after: 'live' },
    ]);
  });
});
