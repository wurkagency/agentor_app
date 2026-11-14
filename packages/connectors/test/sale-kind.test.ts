import { describe, expect, it } from 'vitest';
import {
  chargedRates,
  saleKind,
  vatMismatch,
  type Customer,
  type OrderLine,
  type SaleKind,
} from '../src/index.js';

/** saleKind v2: the VAT the shop charged decides first (PLAN D3). */

const customer = (country: string, vatNumber: string | null = null): Customer => ({
  sourceId: 'c-1',
  kind: vatNumber ? 'company' : 'person',
  name: 'Test',
  email: null,
  phone: null,
  vatNumber,
  address: { line1: null, postalCode: null, city: null, country },
});

const line = (vatRate: number): OrderLine => ({
  sku: null,
  productId: null,
  name: 'Vare',
  quantity: 1,
  unitPrice: 10000,
  vatRate,
  category: null,
});

describe('saleKind v2', () => {
  it.each<[string, string, string | null, number[], SaleKind]>([
    ['Danish customer', 'DK', null, [0.25], 'domestic'],
    ['Danish customer, VAT-free goods', 'DK', null, [0], 'domestic'],
    ['EU private customer, Danish VAT', 'DE', null, [0.25], 'euB2c'],
    ['EU business, reverse charge', 'DE', 'DE811000001', [0], 'euB2b'],
    ['EU business charged Danish VAT', 'DE', 'DE811000001', [0.25], 'domestic'],
    ['EU private customer, destination VAT (OSS)', 'SE', null, [0.25, 0.12], 'euB2c'],
    ['EU private customer, German VAT', 'DE', null, [0.19], 'euB2c'],
    ['Outside the EU, VAT-free export', 'NO', null, [0], 'export'],
    ['Outside the EU charged Danish VAT', 'US', null, [0.25], 'domestic'],
    ['Outside the EU charged foreign VAT', 'NO', null, [0.25, 0.15], 'export'],
  ])('%s', (_name, country, vat, rates, kind) => {
    expect(saleKind({ customer: customer(country, vat), lines: rates.map(line) })).toBe(kind);
  });

  it('keeps the v1 rule for records without lines (customers)', () => {
    expect(saleKind({ customer: customer('DE', 'DE811000001') })).toBe('euB2b');
    expect(saleKind({ customer: customer('FR') })).toBe('euB2c');
    expect(saleKind({ customer: customer('US') })).toBe('export');
  });

  it("prefers the shop's VAT lines over the line rates", () => {
    const vatLines = [{ rateId: '7', code: 'SE-MOMS-1', label: 'Moms', rate: 0.25, amount: 2500 }];
    expect(chargedRates({ lines: [line(0)], vatLines })).toEqual([0.25]);
    expect(saleKind({ customer: customer('SE'), lines: [line(0)], vatLines })).toBe('euB2c');
  });
});

describe('vatMismatch', () => {
  it('warns about foreign VAT and VAT on reverse charge or export, not Danish VAT', () => {
    expect(vatMismatch('euB2c', 0.19)).toBe('FOREIGN_VAT');
    expect(vatMismatch('euB2b', 0.19)).toBe('VAT_ON_REVERSE_CHARGE');
    expect(vatMismatch('export', 0.15)).toBe('VAT_ON_EXPORT');
    expect(vatMismatch('euB2c', 0.25)).toBeNull();
    expect(vatMismatch('domestic', 0)).toBeNull();
  });
});
