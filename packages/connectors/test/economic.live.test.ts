import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Order } from '../src/index.js';
import { EconomicAdapter } from '../src/live/index.js';

/**
 * Checks against a real e-conomic agreement (PLAN-INTEGRATIONS-ECONOMIC §9). The keys come from
 * `.env.local` (ECONOMIC_TEST_*). With `ECONOMIC_TEST_DEMO=1` and no keys the suite reads the
 * public demo agreement (`demo`/`demo`, GET only). Without either it skips itself. Writes only
 * with `ECONOMIC_TEST_WRITE=1`: a draft in Kladde, deleted again. Credentials are never printed.
 */

function env(): Record<string, string> {
  const file = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  const out: Record<string, string> = {};
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(ECONOMIC_TEST_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  return {
    ...out,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.startsWith('ECONOMIC_TEST_')),
    ),
  } as Record<string, string>;
}

const e = env();
const own = Boolean(e.ECONOMIC_TEST_APP_SECRET_TOKEN && e.ECONOMIC_TEST_GRANT_TOKEN);
const demo = !own && e.ECONOMIC_TEST_DEMO === '1';

describe.skipIf(!own && !demo)(
  `e-conomic live (${own ? 'test agreement' : 'demo, read-only'})`,
  () => {
    const adapter = () =>
      new EconomicAdapter({
        connectorId: 'economic',
        mode: 'live',
        credentials: { grantToken: own ? e.ECONOMIC_TEST_GRANT_TOKEN! : 'demo' },
        app: { appSecretToken: own ? e.ECONOMIC_TEST_APP_SECRET_TOKEN! : 'demo' },
      });

    it('tests the connection with /self', async () => {
      const r = await adapter().test();
      expect(r.ok).toBe(true);
    }, 30_000);

    it('reads the master data the editor needs', async () => {
      const a = adapter();
      for (const list of [
        'layouts',
        'vatZones',
        'paymentTerms',
        'customerGroups',
        'productGroups',
        'journals',
      ] as const)
        expect((await a.lookup(list)).length, list).toBeGreaterThan(0);
      const accounts = await a.lookup('accounts');
      expect(accounts.length).toBeGreaterThan(0);
    }, 60_000);

    it('reads customers, products, stock and invoice status', async () => {
      const a = adapter();
      const customers = await a.fetch('customer', { limit: 5 });
      expect(customers.length).toBeGreaterThan(0);
      expect(customers[0]!.address.country).toMatch(/^[A-Z]{2}$/);
      expect((await a.fetch('product', { limit: 5 })).length).toBeGreaterThan(0);
      await a.fetch('stock', { limit: 5 });
      await a.fetch('invoiceStatus', { limit: 5 });
      expect(await a.count('customer')).toBeGreaterThan(0);
    }, 60_000);

    it('finds drafts by external id (Q2C filter)', async () => {
      const a = adapter();
      // A dry run looks up the draft by externalId and the booked invoice by reference.
      const r = await a.write(
        'order',
        {
          sourceId: 'live-probe',
          number: 'live-probe',
          createdAt: new Date().toISOString(),
          status: 'processing',
          currency: 'DKK',
          customer: {
            sourceId: '1',
            kind: 'person',
            name: 'Probe',
            email: null,
            phone: null,
            vatNumber: null,
            address: { line1: null, postalCode: null, city: null, country: 'DK' },
          },
          lines: [],
          shipping: 0,
          shippingVatRate: 0.25,
          total: 0,
        } satisfies Order,
        { mode: 'dry_run', fields: { 'invoice.externalId': 'ag:probe:o:none' } },
      );
      expect(r.action).toBe('create');
    }, 30_000);
  },
);
