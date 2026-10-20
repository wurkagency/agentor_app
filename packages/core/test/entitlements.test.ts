import { describe, expect, it } from 'vitest';
import {
  addMonth,
  billingPeriod,
  canAdd,
  overagePrice,
  parseEntitlements,
  planChangeBlockers,
  quotaState,
  recommendPlan,
  withVat,
  type Entitlements,
} from '../src/entitlements.js';

const ROWS = [
  { key: 'integration_sets', value: 1 },
  { key: 'destinations_per_flow', value: 3 },
  { key: 'transactions_per_month', value: 100 },
  { key: 'seats', value: 2 },
  { key: 'polling_interval_minutes', value: 15 },
  { key: 'payload_retention_days', value: 30 },
  { key: 'run_history_months', value: 13 },
  { key: 'audit_retention_months', value: 24 },
  { key: 'overage_price_ore_per_1000', value: 10000 },
  { key: 'quota_grace_days', value: 7 },
  { key: 'features', value: { included: ['transactions'], excluded: [] } },
  { key: 'recommended_for_orders', value: ['lt100'] },
  { key: 'recommended_for_systems', value: 3 },
  { key: 'unknown_future_key', value: true },
];

const startup = parseEntitlements(ROWS);
const enterprise: Entitlements = {
  ...startup,
  integrationSets: null,
  destinationsPerFlow: null,
  seats: null,
  transactionsPerMonth: 2000,
  recommendedForOrders: ['gt1000'],
  recommendedForSystems: null,
};
const business: Entitlements = {
  ...startup,
  transactionsPerMonth: 1000,
  recommendedForOrders: ['100-1000'],
  recommendedForSystems: 3,
};

describe('parseEntitlements', () => {
  it('maps rows to entitlements and ignores unknown keys', () => {
    expect(startup.seats).toBe(2);
    expect(startup.features.included).toEqual(['transactions']);
  });
  it('fails loudly on a missing or malformed limit instead of defaulting to unlimited', () => {
    expect(() => parseEntitlements(ROWS.filter((r) => r.key !== 'seats'))).toThrow(/seats/);
    expect(() =>
      parseEntitlements(ROWS.map((r) => (r.key === 'seats' ? { key: 'seats', value: '2' } : r))),
    ).toThrow(/seats/);
  });
  it('accepts null as unlimited', () => {
    const e = parseEntitlements(ROWS.map((r) => (r.key === 'seats' ? { ...r, value: null } : r)));
    expect(e.seats).toBeNull();
    expect(canAdd(500, e.seats)).toBe(true);
  });
});

describe('quotaState', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  const base = { planLimit: 1000, addonTransactions: 0, exceededAt: null, graceDays: 7, now };
  it('warns from 80 %', () => {
    expect(quotaState({ ...base, used: 799 }).level).toBe('ok');
    expect(quotaState({ ...base, used: 800 }).level).toBe('warn');
  });
  it('keeps running for 7 days over 100 %, then needs an add-on', () => {
    const over = quotaState({ ...base, used: 1000, exceededAt: new Date('2026-10-15T10:00:00Z') });
    expect(over.level).toBe('over');
    expect(over.graceEndsAt?.toISOString()).toBe('2026-10-22T10:00:00.000Z');
    const expired = quotaState({
      ...base,
      used: 1200,
      exceededAt: new Date('2026-10-12T09:00:00Z'),
    });
    expect(expired.level).toBe('needsAddon');
  });
  it('counts add-ons towards the limit', () => {
    const s = quotaState({ ...base, used: 1500, addonTransactions: 1000 });
    expect(s.limit).toBe(2000);
    expect(s.level).toBe('ok');
  });
  it('never limits an unlimited plan', () => {
    expect(quotaState({ ...base, planLimit: null, used: 10 ** 7 }).level).toBe('ok');
  });
});

describe('planChangeBlockers', () => {
  const usage = {
    integrationSets: 2,
    maxDestinationsInFlow: 4,
    seats: 3,
    transactionsThisMonth: 712,
  };
  it('lists every limit the tenant is above', () => {
    expect(planChangeBlockers(startup, usage)).toEqual([
      'integrationSets',
      'destinationsPerFlow',
      'seats',
      'transactionsPerMonth',
    ]);
  });
  it('allows an upgrade', () => {
    expect(planChangeBlockers(enterprise, usage)).toEqual([]);
  });
});

describe('money and periods', () => {
  it('adds 25 % VAT in øre', () => {
    expect(withVat(15900)).toEqual({ net: 15900, vat: 3975, gross: 19875 });
  });
  it('prices add-ons in started blocks of 1.000', () => {
    expect(overagePrice(0, 10000)).toBe(0);
    expect(overagePrice(1, 10000)).toBe(10000);
    expect(overagePrice(1001, 10000)).toBe(20000);
  });
  it('uses the Danish month, not UTC', () => {
    expect(billingPeriod(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });
  it('adds a month, clamping to the last day', () => {
    expect(addMonth(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addMonth(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
  it('recommends a plan from orders per month and number of systems', () => {
    const plans = [
      { id: 'startup', entitlements: startup },
      { id: 'business', entitlements: business },
      { id: 'enterprise', entitlements: enterprise },
    ];
    expect(recommendPlan(plans, { ordersPerMonth: 'gt1000' })).toBe('enterprise');
    expect(recommendPlan(plans, { ordersPerMonth: '100-1000', systemCount: 3 })).toBe('business');
    // More systems than Business suits: the next plan that suits them.
    expect(recommendPlan(plans, { ordersPerMonth: '100-1000', systemCount: 4 })).toBe('enterprise');
    expect(recommendPlan(plans, { ordersPerMonth: 'lt100', systemCount: 2 })).toBe('startup');
    expect(recommendPlan(plans, { ordersPerMonth: null })).toBeNull();
    expect(recommendPlan(plans, { ordersPerMonth: 'unknown' })).toBeNull();
  });
});

describe('monthStart', () => {
  it('is local midnight in Copenhagen, in summer and winter time', async () => {
    const { monthStart } = await import('../src/entitlements.js');
    expect(monthStart(2026, 10).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(monthStart(2026, 11).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(monthStart(2027, 1).toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});
