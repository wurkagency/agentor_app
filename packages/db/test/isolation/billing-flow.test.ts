import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import {
  applyChargeResult,
  applySubscriptionAuthorized,
  attachPaymentSubscription,
  changePlan,
  dueSubscriptions,
  getBillingOverview,
  getPaymentSubscription,
  prepareCharge,
  resolveBillingRef,
} from '../../src/repo/billing.js';
import { roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin } from './helpers.js';

/**
 * The billing lifecycle through the repository, as the web and worker roles really run it:
 * onboarding creates the company, the owner adds a card, the worker activates and charges.
 * Uses its own tenant and deletes it afterwards, so the other suites see the seeded data.
 */

let web: DatabaseHandle;
let worker: DatabaseHandle;
let tenantId = '';
const user = ID.userInviteeA;

beforeAll(async () => {
  const db = inject('isolationDb');
  web = createDatabase(roleUrl('web', db), { max: 2 });
  worker = createDatabase(roleUrl('worker', db), { max: 2 });
  const c = await web.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.user_id', $1, true)`, [user]);
    const res = await c.query(
      `select app.create_tenant('Flow Test ApS', '', '', '', '', '', 'da', 'Europe/Copenhagen', '200-1000') as t`,
    );
    await c.query('commit');
    tenantId = res.rows[0].t;
  } finally {
    c.release();
  }
});

afterAll(async () => {
  if (tenantId) await admin('delete from tenants where id = $1', [tenantId]);
  await web?.close();
  await worker?.close();
});

const actor = () => ({ tenantId, userId: user, name: 'Test Ejer' });

describe('billing lifecycle', () => {
  it('starts on Business, incomplete, not due', async () => {
    const o = await getBillingOverview(web.db, actor());
    expect(o?.plan.id).toBe('business');
    expect(o?.subscription.status).toBe('incomplete');
    expect(await dueSubscriptions(worker.db)).not.toContain(tenantId);
  });

  it('an upgrade is allowed, a no-op change is refused', async () => {
    await changePlan(web.db, actor(), 'enterprise');
    await expect(changePlan(web.db, actor(), 'enterprise')).rejects.toMatchObject({
      code: 'SAME_PLAN',
    });
    await changePlan(web.db, actor(), 'business');
  });

  it('the card flow activates the subscription and makes it due', async () => {
    await attachPaymentSubscription(web.db, actor(), 'AGFLOWSUB0001', 'qp-sub-1');
    const ref = await resolveBillingRef(worker.db, 'AGFLOWSUB0001');
    expect(ref).toMatchObject({ tenantId, kind: 'subscription' });
    await applySubscriptionAuthorized(worker.db, ref!.tenantId, ref!.refId, {
      brand: 'visa',
      last4: '4242',
      expiry: '08/28',
    });
    const o = await getBillingOverview(web.db, actor());
    expect(o?.subscription).toMatchObject({ status: 'active', cardLast4: '4242' });
    expect(await dueSubscriptions(worker.db, new Date(Date.now() + 1000))).toContain(tenantId);
  });

  it('a charge creates one invoice per period, even when retried', async () => {
    let n = 0;
    const orderId = () => `AGFLOWINV${String(++n).padStart(4, '0')}`;
    const first = await prepareCharge(worker.db, tenantId, orderId);
    expect(first).toMatchObject({
      amountOre: 19875,
      resumed: false,
      providerSubscriptionId: 'qp-sub-1',
    });
    const retry = await prepareCharge(worker.db, tenantId, orderId);
    expect(retry).toMatchObject({
      invoiceId: first!.invoiceId,
      orderId: first!.orderId,
      resumed: true,
    });
    expect(first!.number).toMatch(/^AG-\d{4}-\d{4,}$/);
  });

  it('a failed charge marks the subscription past due; a later success recovers it', async () => {
    const charge = (await prepareCharge(worker.db, tenantId, () => 'AGUNUSED0001'))!;
    await applyChargeResult(worker.db, tenantId, charge.invoiceId, {
      accepted: false,
      providerPaymentId: 'p1',
    });
    expect((await getBillingOverview(web.db, actor()))?.subscription.status).toBe('past_due');
    await applyChargeResult(worker.db, tenantId, charge.invoiceId, {
      accepted: true,
      providerPaymentId: 'p2',
    });
    const o = await getBillingOverview(web.db, actor());
    expect(o?.subscription.status).toBe('active');
    expect(o?.subscription.pastDueSince).toBeNull();
    // Paid: the next period is not due yet, and a duplicate callback changes nothing.
    expect(await dueSubscriptions(worker.db)).not.toContain(tenantId);
    await applyChargeResult(worker.db, tenantId, charge.invoiceId, {
      accepted: false,
      providerPaymentId: 'p3',
    });
    expect((await getBillingOverview(web.db, actor()))?.subscription.status).toBe('active');
  });

  it('the web role cannot apply payment results', async () => {
    const sub = await getPaymentSubscription(web.db, actor());
    await expect(
      applySubscriptionAuthorized(web.db, tenantId, sub!.id, {
        brand: 'visa',
        last4: '0000',
        expiry: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    const charge = await prepareCharge(web.db, tenantId, () => 'AGWEB0000001').catch((e) => e);
    expect(charge).toBeInstanceOf(Error);
  });
});
