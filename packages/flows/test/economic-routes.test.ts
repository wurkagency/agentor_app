import {
  MOCK_ORDERS,
  type ConnectorAdapter,
  type WriteOptions,
  type WriteResult,
} from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import { parseDefinition, runRoute, validateDefinition } from '../src/index.js';

/** The engine with e-conomic as destination (PLAN-INTEGRATIONS-ECONOMIC X3, X5). */

const WOO = '0190b000-0000-7000-8000-000000000301';
const ECO = '0190b000-0000-7000-8000-000000000304';

const defWith = (
  settings: Record<string, string | boolean>,
  mapping: Record<string, string> = {},
) =>
  parseDefinition({
    nodes: [
      { id: 'src', role: 'source', connectionId: WOO },
      { id: 'eco', role: 'destination', connectionId: ECO },
    ],
    routes: [
      {
        id: 'orders-economic',
        from: 'src',
        to: 'eco',
        entity: 'order',
        targetEntity: 'order',
        mode: 'draft',
        settings,
        mapping,
      },
    ],
  });

function economicDouble(result: Partial<WriteResult> = {}) {
  const seen: WriteOptions[] = [];
  const adapter = {
    connectorId: 'economic',
    write: async (_e: unknown, _r: unknown, opts: WriteOptions) => {
      seen.push(opts);
      return { action: 'create', destinationId: 'd:1001', ...result };
    },
  } as unknown as ConnectorAdapter;
  return { adapter, seen };
}

const ctx = {
  connections: {
    [WOO]: { connectorId: 'woocommerce', status: 'ok' as const, name: 'nordlys-cykler.dk' },
    [ECO]: { connectorId: 'economic', status: 'ok' as const, name: 'Nordlys Outlet ApS' },
  },
  lookups: {},
  maxDestinations: 3,
};

describe('e-conomic routes in the engine', () => {
  it('books invoices without accounts: the product group decides', async () => {
    const def = defWith({});
    const { adapter, seen } = economicDouble();
    const [res] = await runRoute({
      def,
      route: def.routes[0]!,
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      dryRun: false,
      existingId: () => null,
    });
    expect(res).toMatchObject({ outcome: 'created', destinationId: 'd:1001' });
    expect(seen[0]!.route!.accounts).toBeUndefined();
    expect(seen[0]!.route!.settings['posting.type']).toBe('invoice');
    expect(validateDefinition(def, ctx).filter((f) => f.code === 'MAPPING_REQUIRED')).toEqual([]);
  });

  it('needs accounts for journal vouchers and passes them per line', async () => {
    const missing = defWith({ 'posting.type': 'journal' });
    const { adapter } = economicDouble();
    const [failed] = await runRoute({
      def: missing,
      route: missing.routes[0]!,
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      dryRun: false,
      existingId: () => null,
    });
    expect(failed).toMatchObject({ outcome: 'failed', errorCode: 'ACCOUNT_MISSING' });
    expect(validateDefinition(missing, ctx).some((f) => f.code === 'MAPPING_REQUIRED')).toBe(true);

    const mapped = defWith(
      { 'posting.type': 'journal' },
      {
        'accounts.domestic': '1010',
        'accounts.vatFree': '1011',
        'accounts.euB2b': '1015',
        'accounts.export': '1020',
        'accounts.shipping': '1090',
        'accounts.shippingVatFree': '1091',
      },
    );
    const ok = economicDouble();
    await runRoute({
      def: mapped,
      route: mapped.routes[0]!,
      records: [MOCK_ORDERS[1]!],
      destination: ok.adapter,
      dryRun: false,
      existingId: () => null,
    });
    expect(ok.seen[0]!.route!.accounts!.length).toBeGreaterThan(0);
    expect(ok.seen[0]!.route!.accounts!.every((a) => a !== null)).toBe(true);
  });

  it('renders the external id with the short connection id', async () => {
    const def = defWith({});
    const { adapter, seen } = economicDouble();
    await runRoute({
      def,
      route: def.routes[0]!,
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      dryRun: false,
      existingId: () => null,
    });
    const ext = seen[0]!.fields!['invoice.externalId']!;
    expect(ext).toBe(`ag:${WOO.slice(0, 8)}:o:${MOCK_ORDERS[1]!.sourceId}`);
    expect(ext.length).toBeLessThanOrEqual(50);
    expect(seen[0]!.fields!['invoice.otherReference']).toBe(MOCK_ORDERS[1]!.number);
  });
});
