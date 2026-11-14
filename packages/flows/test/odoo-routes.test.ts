import {
  MOCK_ORDERS,
  type ConnectorAdapter,
  type WriteOptions,
  type WriteResult,
} from '@agentor/connectors';
import { describe, expect, it } from 'vitest';
import { parseDefinition, runRoute, validateDefinition } from '../src/index.js';

/** The engine with Odoo as destination (PLAN-INTEGRATIONS-WOO-ODOO16 P2–P3). */

const WOO = '0190b000-0000-7000-8000-000000000301';
const ODOO = '0190b000-0000-7000-8000-000000000309';

const def = parseDefinition({
  nodes: [
    { id: 'src', role: 'source', connectionId: WOO },
    { id: 'odoo', role: 'destination', connectionId: ODOO },
  ],
  routes: [
    {
      id: 'orders-odoo',
      from: 'src',
      to: 'odoo',
      entity: 'order',
      targetEntity: 'order',
      mode: 'draft',
      mapping: { 'tax.domestic': '1' },
      templates: { 'order.fields.x_studio_kanal': 'Web {order.number}' },
    },
  ],
});
const route = def.routes[0]!;

/** An Odoo stand-in that records what the engine passes and answers with a warning. */
function odooDouble(result: Partial<WriteResult> = {}) {
  const seen: WriteOptions[] = [];
  const adapter = {
    connectorId: 'odoo',
    write: async (_e: unknown, _r: unknown, opts: WriteOptions) => {
      seen.push(opts);
      return { action: 'create', destinationId: 'sale.order,7', ...result };
    },
  } as unknown as ConnectorAdapter;
  return { adapter, seen };
}

const ctx = (
  fields: { value: string; label: string; meta?: Record<string, string | number | boolean> }[],
) => ({
  connections: {
    [WOO]: { connectorId: 'woocommerce', status: 'ok' as const, name: 'nordlys-cykler.dk' },
    [ODOO]: { connectorId: 'odoo', status: 'ok' as const, name: 'Nordlys Cykler ApS' },
  },
  lookups: { [ODOO]: { 'fields:sale.order': fields } },
  maxDestinations: 3,
});

describe('Odoo routes in the engine', () => {
  it('does not ask for Dinero accounts, and passes Odoo’s warnings on', async () => {
    const { adapter, seen } = odooDouble({
      warnings: [{ code: 'VAT_RATE_MISMATCH', params: { line: 'x', shop: '19', odoo: '25' } }],
    });
    const [res] = await runRoute({
      def,
      route,
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      dryRun: false,
      existingId: () => null,
    });
    expect(res).toMatchObject({
      outcome: 'created',
      destinationId: 'sale.order,7',
    });
    expect(res!.failure).toBeUndefined();
    expect(res!.warnings).toContainEqual({
      code: 'VAT_RATE_MISMATCH',
      params: { line: 'x', shop: '19', odoo: '25' },
    });
    expect(seen[0]!.route!.accounts).toBeUndefined();
  });

  it('renders templates for the customer’s own Odoo fields', async () => {
    const { adapter, seen } = odooDouble();
    await runRoute({
      def,
      route,
      records: [MOCK_ORDERS[1]!],
      destination: adapter,
      dryRun: false,
      existingId: () => null,
    });
    expect(seen[0]!.fields).toMatchObject({
      'order.fields.x_studio_kanal': `Web ${MOCK_ORDERS[1]!.number}`,
      'order.externalId': `woo_${WOO}_order_${MOCK_ORDERS[1]!.sourceId}`,
    });
  });

  it('accepts a template for a custom field Odoo has, and flags one it does not', () => {
    const has = validateDefinition(
      def,
      ctx([{ value: 'x_studio_kanal', label: 'Kanal', meta: { type: 'char' } }]),
    );
    expect(has.filter((f) => f.code === 'TEMPLATE_UNKNOWN_FIELD')).toEqual([]);
    const gone = validateDefinition(def, ctx([]));
    expect(gone.filter((f) => f.code === 'TEMPLATE_UNKNOWN_FIELD')).toHaveLength(1);
  });
});
