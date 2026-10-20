import { QuickPayError, type QuickPayClient } from '@agentor/billing';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  resolveBillingRef: vi.fn(),
  applySubscriptionAuthorized: vi.fn(async () => ({ chargeNow: false })),
  activateSignupIfPaid: vi.fn(async () => false),
  signupPurgeCandidates: vi.fn(),
  providerSubscriptionFor: vi.fn(),
  purgeSignupTenant: vi.fn(),
  purgeSignupUsers: vi.fn(),
  applyChargeResult: vi.fn(),
  prepareCharge: vi.fn(),
}));
vi.mock('@agentor/db', () => repo);

const { processBillingJob } = await import('../src/billing.js');

const TENANT = '0190a000-0000-7000-8000-00000000000a';
const recurring = vi.fn();
const deps = {
  db: {} as never,
  quickpay: { mode: 'test', recurring } as unknown as QuickPayClient,
  mode: 'test' as const,
  callbackUrl: 'https://ingest.example/billing/quickpay',
  log: pino({ level: 'silent' }),
};

beforeEach(() => vi.clearAllMocks());

const callback = (over: Record<string, unknown>) => ({
  body: JSON.stringify({
    id: 5,
    type: 'Subscription',
    order_id: 'AGORDER0001',
    accepted: true,
    test_mode: true,
    metadata: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 },
    ...over,
  }),
});

describe('QuickPay callbacks', () => {
  it('activates the subscription the order id belongs to', async () => {
    repo.resolveBillingRef.mockResolvedValue({
      tenantId: TENANT,
      kind: 'subscription',
      refId: 's1',
    });
    await processBillingJob(deps, 'quickpay.callback', callback({}));
    expect(repo.applySubscriptionAuthorized).toHaveBeenCalledWith({}, TENANT, 's1', {
      brand: 'visa',
      last4: '4242',
      expiry: '08/28',
    });
  });

  it('ignores unknown orders and mismatched types', async () => {
    repo.resolveBillingRef.mockResolvedValue(null);
    await processBillingJob(deps, 'quickpay.callback', callback({}));
    repo.resolveBillingRef.mockResolvedValue({ tenantId: TENANT, kind: 'invoice', refId: 'i1' });
    await processBillingJob(deps, 'quickpay.callback', callback({}));
    expect(repo.applySubscriptionAuthorized).not.toHaveBeenCalled();
    expect(repo.applyChargeResult).not.toHaveBeenCalled();
  });

  it('applies payment outcomes to the invoice', async () => {
    repo.resolveBillingRef.mockResolvedValue({ tenantId: TENANT, kind: 'invoice', refId: 'i1' });
    await processBillingJob(
      deps,
      'quickpay.callback',
      callback({ type: 'Payment', accepted: false }),
    );
    expect(repo.applyChargeResult).toHaveBeenCalledWith({}, TENANT, 'i1', {
      accepted: false,
      providerPaymentId: '5',
    });
  });
});

describe('signup (PLAN-SIGNUP §4.2)', () => {
  const charge = {
    invoiceId: 'i1',
    number: 'INV/2026/01001',
    orderId: 'AGCHARGE0001',
    amountOre: 198750,
    providerSubscriptionId: 'qp1',
    resumed: false,
  };

  it('charges the first period as soon as the card is authorised', async () => {
    repo.resolveBillingRef.mockResolvedValue({
      tenantId: TENANT,
      kind: 'subscription',
      refId: 's1',
    });
    repo.applySubscriptionAuthorized.mockResolvedValueOnce({ chargeNow: true });
    repo.prepareCharge.mockResolvedValue(charge);
    recurring.mockResolvedValue({ paymentId: '77', accepted: null });
    await processBillingJob(deps, 'quickpay.callback', callback({}));
    expect(repo.prepareCharge).toHaveBeenCalledWith({}, TENANT, expect.any(Function));
    expect(recurring).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'qp1', amountOre: 198750 }),
    );
  });

  it('activates the company only from an accepted Payment callback', async () => {
    repo.resolveBillingRef.mockResolvedValue({ tenantId: TENANT, kind: 'invoice', refId: 'i1' });
    await processBillingJob(
      deps,
      'quickpay.callback',
      callback({ type: 'Payment', accepted: false }),
    );
    expect(repo.activateSignupIfPaid).not.toHaveBeenCalled();
    await processBillingJob(
      deps,
      'quickpay.callback',
      callback({ type: 'Payment', accepted: true }),
    );
    expect(repo.activateSignupIfPaid).toHaveBeenCalledWith({}, TENANT, 'i1');
  });

  it('never activates from the synchronous answer to our own charge request', async () => {
    repo.prepareCharge.mockResolvedValue(charge);
    recurring.mockResolvedValue({ paymentId: '77', accepted: true });
    await processBillingJob(deps, 'billing.charge', { tenantId: TENANT });
    expect(repo.applyChargeResult).toHaveBeenCalled();
    expect(repo.activateSignupIfPaid).not.toHaveBeenCalled();
  });
});

describe('signup purge (B1)', () => {
  it('cancels the saved card before deleting the company, and skips it if QuickPay fails', async () => {
    const cancelSubscription = vi.fn(async (id: string) => {
      if (id === 'qp-down') throw new QuickPayError('down', 503);
      if (id === 'qp-gone') throw new QuickPayError('gone', 404);
    });
    const d = { ...deps, quickpay: { ...deps.quickpay, cancelSubscription } as QuickPayClient };
    repo.signupPurgeCandidates.mockResolvedValue(['t1', 't2', 't3', 't4']);
    repo.providerSubscriptionFor.mockImplementation(
      async (_db: unknown, t: string) =>
        ({ t1: 'qp1', t2: 'qp-down', t3: 'qp-gone', t4: null })[t] ?? null,
    );
    repo.purgeSignupTenant.mockResolvedValue(true);
    repo.purgeSignupUsers.mockResolvedValue(2);
    await processBillingJob(d, 'signup.purge', {});
    expect(cancelSubscription).toHaveBeenCalledTimes(3);
    expect(repo.purgeSignupTenant.mock.calls.map((c) => c[1])).toEqual(['t1', 't3', 't4']);
    expect(repo.purgeSignupUsers).toHaveBeenCalledOnce();
  });
});

describe('monthly charge', () => {
  const charge = {
    invoiceId: 'i1',
    number: 'INV/2026/01001',
    orderId: 'AGORDER0002',
    amountOre: 19875,
    providerSubscriptionId: 'qp1',
    resumed: false,
  };

  it('charges the invoice amount and applies a synchronous result', async () => {
    repo.prepareCharge.mockResolvedValue(charge);
    recurring.mockResolvedValue({ paymentId: 'p1', accepted: true });
    await processBillingJob(deps, 'billing.charge', { tenantId: TENANT });
    expect(recurring).toHaveBeenCalledWith({
      subscriptionId: 'qp1',
      orderId: 'AGORDER0002',
      amountOre: 19875,
      callbackUrl: deps.callbackUrl,
    });
    expect(repo.applyChargeResult).toHaveBeenCalledWith({}, TENANT, 'i1', {
      accepted: true,
      providerPaymentId: 'p1',
    });
  });

  it('does nothing when nothing is due', async () => {
    repo.prepareCharge.mockResolvedValue(null);
    await processBillingJob(deps, 'billing.charge', { tenantId: TENANT });
    expect(recurring).not.toHaveBeenCalled();
  });

  it('waits for the callback when a resumed order is already known to QuickPay', async () => {
    repo.prepareCharge.mockResolvedValue({ ...charge, resumed: true });
    recurring.mockRejectedValue(new QuickPayError('dup', 400));
    await processBillingJob(deps, 'billing.charge', { tenantId: TENANT });
    expect(repo.applyChargeResult).not.toHaveBeenCalled();
  });

  it('lets network errors fail the job so BullMQ retries', async () => {
    repo.prepareCharge.mockResolvedValue(charge);
    recurring.mockRejectedValue(new QuickPayError('down', 503));
    await expect(processBillingJob(deps, 'billing.charge', { tenantId: TENANT })).rejects.toThrow();
  });

  it('refuses malformed payloads', async () => {
    await expect(processBillingJob(deps, 'billing.charge', { tenantId: 'x' })).rejects.toThrow();
    await expect(processBillingJob(deps, 'nope', {})).rejects.toThrow(/unknown/);
  });
});
