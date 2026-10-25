import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  adapterFor,
  CATALOGUE,
  countRecords,
  MANIFESTS,
  manifestFor,
  MOCK_ORDERS,
  saleKind,
  verifyWebhookSignature,
} from '../src/index.js';

describe('catalogue and manifests', () => {
  it('lists 24 systems, 8 of them connectable (D9-Katalog plus Odoo)', () => {
    expect(CATALOGUE).toHaveLength(24);
    expect(
      CATALOGUE.filter((c) => c.available)
        .map((c) => c.id)
        .sort(),
    ).toEqual([
      'brevo',
      'dinero',
      'economic',
      'hubspot',
      'mailchimp',
      'odoo',
      'shopify',
      'woocommerce',
    ]);
    expect(new Set(CATALOGUE.map((c) => c.id)).size).toBe(24);
  });

  it('every manifest has unique stable mapping keys and at least one port', () => {
    for (const m of Object.values(MANIFESTS)) {
      expect(m.outputs.length + m.inputs.length, m.id).toBeGreaterThan(0);
      for (const groups of Object.values(m.mapping ?? {})) {
        const keys = groups!.flatMap((g) => g.fields.map((f) => f.key));
        expect(new Set(keys).size, m.id).toBe(keys.length);
      }
    }
  });
});

describe('mock fixtures match D5-Testkørsel', () => {
  it('has #10447 as an EU B2B sale of 4.395 kr. and #10444 at 0 kr.', () => {
    const [o447] = MOCK_ORDERS;
    expect(o447!.number).toBe('10447');
    expect(o447!.total).toBe(439500);
    expect(saleKind(o447!)).toBe('euB2b');
    expect(MOCK_ORDERS.find((o) => o.number === '10444')!.total).toBe(0);
    expect(MOCK_ORDERS.find((o) => o.number === '10446')!.total).toBe(1899500);
    expect(MOCK_ORDERS.find((o) => o.number === '10445')!.total).toBe(124900);
    expect(MOCK_ORDERS.find((o) => o.number === '10443')!.total).toBe(64900);
    expect(MOCK_ORDERS).toHaveLength(10);
  });
});

describe('mock adapter', () => {
  it('tests credentials and reports the account', async () => {
    const ok = await adapterFor({
      connectorId: 'dinero',
      credentials: { token: 'x' },
      mode: 'mock',
    }).test();
    expect(ok).toEqual({ ok: true, account: { id: '412983', name: 'Nordlys Cykler' } });
    const bad = await adapterFor({
      connectorId: 'dinero',
      credentials: { token: 'revoked' },
      mode: 'mock',
    }).test();
    expect(bad.ok).toBe(false);
  });

  it('never writes in dry-run and has no live client yet', async () => {
    const a = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
    expect(await a.write('order', MOCK_ORDERS[0]!, { mode: 'dry_run' })).toEqual({
      action: 'create',
      destinationId: null,
    });
    expect(() => adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'live' })).toThrow(
      /no live client/,
    );
    expect(() => adapterFor({ connectorId: 'nope', credentials: {}, mode: 'mock' })).toThrow();
  });
});

describe('webhook signatures', () => {
  it('verifies base64 HMAC-SHA256 over the raw body', () => {
    const body = '{"id":10447}';
    const sig = createHmac('sha256', 'whsec').update(body).digest('base64');
    expect(verifyWebhookSignature(body, sig, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sig, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, 'whsec')).toBe(false);
  });
});

describe('record counts (OB2)', () => {
  it('counts only what the manifest declares, and nothing for connectors that cannot', async () => {
    const woo = adapterFor({ connectorId: 'woocommerce', credentials: {}, mode: 'mock' });
    const counts = await countRecords(woo, manifestFor('woocommerce')?.counts);
    expect(Object.keys(counts).sort()).toEqual(['customer', 'order', 'product']);
    expect(counts.order).toBeGreaterThan(0);
    const dinero = adapterFor({ connectorId: 'dinero', credentials: {}, mode: 'mock' });
    expect(await countRecords(dinero, manifestFor('dinero')?.counts)).toEqual({});
    expect(await countRecords(dinero, ['order'])).toEqual({});
  });
});
