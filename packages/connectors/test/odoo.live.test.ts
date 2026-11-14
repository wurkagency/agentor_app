import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OdooAdapter } from '../src/live/index.js';

/**
 * Read-only checks against a real Odoo (PLAN-INTEGRATIONS-WOO-ODOO16 §8): the test database's
 * keys come from `.env.local` (ODOO_TEST_*), and the suite skips itself when they are missing.
 * It never writes and never prints credentials.
 */

function env(): Record<string, string> {
  const file = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  const out: Record<string, string> = {};
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(ODOO_TEST_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  return {
    ...out,
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ODOO_TEST_'))),
  } as Record<string, string>;
}

const e = env();
const ready = Boolean(
  e.ODOO_TEST_URL && e.ODOO_TEST_DB && e.ODOO_TEST_LOGIN && e.ODOO_TEST_API_KEY,
);

describe.skipIf(!ready)('Odoo live (test database, read-only)', () => {
  const adapter = () =>
    new OdooAdapter({
      connectorId: 'odoo',
      mode: 'live',
      credentials: {
        baseUrl: e.ODOO_TEST_URL!,
        database: e.ODOO_TEST_DB!,
        login: e.ODOO_TEST_LOGIN!,
        apiKey: e.ODOO_TEST_API_KEY!,
      },
      settings: e.ODOO_TEST_COMPANY_ID ? { companyId: e.ODOO_TEST_COMPANY_ID } : {},
    });

  it('passes the connection test', async () => {
    const res = await adapter().test();
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  }, 60_000);

  it('reads the lookups the editor needs', async () => {
    const a = adapter();
    const apps = await a.lookup('apps');
    console.info('Odoo apps:', apps.map((x) => x.value).join(', '), '·', apps[0]?.label);
    for (const list of [
      'companies',
      'warehouses',
      'journals',
      'taxes',
      'fiscalPositions',
    ] as const) {
      const rows = await a.lookup(list);
      console.info(`${list}: ${rows.length}`);
      expect(Array.isArray(rows)).toBe(true);
    }
    const fields = await a.lookup('fields:stock.picking');
    expect(fields.some((f) => f.value === 'name')).toBe(true);
  }, 120_000);

  // Opt-in (ODOO_TEST_WRITE=1): a quotation in Kladde for a test contact, cancelled again.
  it.skipIf(e.ODOO_TEST_WRITE !== '1')(
    'writes a quotation in Kladde and cancels it',
    async () => {
      const a = adapter();
      const [product] = await a.lookup('relation:product.product');
      const tax = (await a.lookup('taxes')).find(
        (x) => x.meta?.amount === 25 && x.meta?.priceInclude === false,
      );
      expect(product && tax, 'needs one product and a 25 % sales tax').toBeTruthy();
      const order = {
        sourceId: `agentor-test-${Date.now()}`,
        number: `AGT-${Date.now()}`,
        createdAt: new Date().toISOString(),
        paidAt: null,
        status: 'processing' as const,
        currency: 'DKK',
        customer: {
          sourceId: 'agentor-test',
          kind: 'person' as const,
          name: 'Agentor Test',
          email: 'agentor-test@example.invalid',
          phone: null,
          vatNumber: null,
          address: { line1: 'Testvej 1', postalCode: '8000', city: 'Aarhus C', country: 'DK' },
        },
        lines: [
          {
            sku: null,
            productId: null,
            name: 'Agentor testlinje',
            quantity: 1,
            unitPrice: 10000,
            vatRate: 0.25,
            category: null,
          },
        ],
        shipping: 0,
        shippingVatRate: 0,
        total: 12500,
      };
      const route = {
        settings: {
          'products.match': 'none',
          'products.genericId': product!.value,
          'rounding.policy': 'ignoreBelow',
        },
        mapping: { 'tax.domestic': tax!.value },
        tables: {},
      };
      const fields = { 'order.externalId': `agentor_test_order_${order.sourceId}` };
      const res = await a.write('order', order, { mode: 'draft', fields, route });
      console.info('Odoo quotation:', res.destinationId, res.warnings ?? []);
      expect(res.destinationId).toMatch(/^sale\.order,\d+$/);
      const cancelled = await a.write(
        'order',
        { ...order, status: 'cancelled' },
        { mode: 'live', fields, route },
      );
      expect(cancelled.action).toBe('update');
    },
    180_000,
  );

  it('reads stock, deliveries and invoice status', async () => {
    const a = adapter();
    for (const entity of ['stock', 'shipment', 'invoiceStatus'] as const) {
      const rows = await a.fetch(entity, { limit: 5 });
      console.info(`${entity}: ${rows.length} read, count ${await a.count(entity)}`);
      for (const r of rows) expect(typeof r.sourceId).toBe('string');
      const first = rows[0];
      if (first) expect((await a.get(entity, first.sourceId))?.sourceId).toBe(first.sourceId);
    }
  }, 180_000);
});
