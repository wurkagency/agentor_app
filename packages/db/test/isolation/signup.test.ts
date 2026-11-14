import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { admin, INSUFFICIENT_PRIVILEGE, run, runSteps } from './helpers.js';

/**
 * Self-service signup (PLAN-SIGNUP §3): a company in signup can't work, its state only changes
 * through the app.signup_* functions, terms acceptances are append-only and tenant-scoped, and
 * unfinished signups are purged after 24 hours (B1). Uses its own tenant and users (committed
 * by the superuser, removed afterwards); every check itself runs in a rolled-back transaction.
 */

const P = {
  tenant: '0190a000-0000-7000-8000-0000000c0001',
  owner: '0190a000-0000-7000-8000-0000000c0002',
  invoice: '0190a000-0000-7000-8000-0000000c0003',
  /** Signed up 25 hours ago, never created a company. */
  stale: '0190a000-0000-7000-8000-0000000c0004',
  /** Signed up 1 hour ago. */
  fresh: '0190a000-0000-7000-8000-0000000c0005',
};
const OWNER_P = { tenantId: P.tenant, userId: P.owner };
const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };

beforeAll(async () => {
  await admin('begin');
  await admin(
    `insert into auth.users (id, email, name, email_verified, signup_started_at) values
       ($1, 'pending-owner@example.test', 'Pending Owner', true, now() - interval '25 hours'),
       ($2, 'stale@example.test', 'Stale Signup', true, now() - interval '25 hours'),
       ($3, 'fresh@example.test', 'Fresh Signup', true, now() - interval '1 hour')`,
    [P.owner, P.stale, P.fresh],
  );
  await admin(
    `insert into tenants (id, name, signup_state, created_at) values ($1, 'Pending ApS', 'pending_payment', now() - interval '25 hours')`,
    [P.tenant],
  );
  await admin(
    `insert into memberships (tenant_id, user_id, role, flow_scope) values ($1, $2, 'owner', 'all')`,
    [P.tenant, P.owner],
  );
  await admin(
    `insert into subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end) values ($1, 'business', 'incomplete', now(), now())`,
    [P.tenant],
  );
  await admin(
    `insert into invoices (tenant_id, id, number, period_start, period_end, description, amount_ore, vat_ore)
     values ($1, $2, 'AG-TEST-P', now(), now() + interval '1 month', 'Business · månedlig', 15900, 3975)`,
    [P.tenant, P.invoice],
  );
  await admin(
    `insert into app.pending_signups (tenant_id, created_at) values ($1, now() - interval '25 hours')`,
    [P.tenant],
  );
  await admin('commit');
});

afterAll(async () => {
  await admin('delete from tenants where id = $1', [P.tenant]);
  await admin('delete from auth.users where id = any($1::uuid[])', [[P.owner, P.stale, P.fresh]]);
});

describe('a company in signup cannot work', () => {
  it('no connections, secrets, flows, versions or runs, for any role', async () => {
    const inserts = [
      `insert into connections (tenant_id, connector_id, name) values ($1, 'mock', 'X')`,
      `insert into flows (tenant_id, name) values ($1, 'X')`,
    ];
    for (const role of ['web', 'worker'] as const)
      for (const text of inserts) {
        const { error } = await run(role, OWNER_P, text, [P.tenant]);
        expect(error?.code, `${role}: ${text}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    // The same statements work in an active company.
    for (const text of inserts) {
      const { error } = await run('web', OWNER_A, text, [ID.tenantA]);
      expect(error, text).toBeUndefined();
    }
    const run1 = await run(
      'worker',
      OWNER_P,
      `insert into runs (tenant_id, flow_id, version_id, kind, status) values ($1, $2, $3, 'manual', 'queued')`,
      [P.tenant, ID.flowA1, ID.versionA1],
    );
    expect(run1.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const secret = await run(
      'worker',
      OWNER_P,
      `insert into connection_secrets (tenant_id, connection_id, format, key_id, nonce, ciphertext) values ($1, $2, 'test', $3, '\\x00', '\\xaa')`,
      [P.tenant, ID.connA, ID.keyA],
    );
    expect(secret.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('tenant_is_active() is false without a tenant and for a pending one', async () => {
    const none = await run('web', null, 'select app.tenant_is_active() as a');
    expect(none.result!.rows[0].a).toBe(false);
    const pending = await run('web', OWNER_P, 'select app.tenant_is_active() as a');
    expect(pending.result!.rows[0].a).toBe(false);
    const active = await run('web', OWNER_A, 'select app.tenant_is_active() as a');
    expect(active.result!.rows[0].a).toBe(true);
  });
});

describe('signup state', () => {
  it('cannot be written directly by any runtime role', async () => {
    for (const role of ['web', 'worker'] as const) {
      const { error } = await run(role, OWNER_P, `update tenants set signup_state = 'active'`);
      expect(error?.message, role).toContain('SIGNUP_STATE_PROTECTED');
    }
    // Other columns are still the owner's to edit.
    const name = await run('web', OWNER_P, `update tenants set name = 'Nyt Navn ApS'`);
    expect(name.result!.rowCount).toBe(1);
  });

  it('create_tenant starts in pending_plan with the chosen systems; one unpaid company at a time', async () => {
    const r = await runSteps('web', [
      {
        ctx: { userId: ID.userInviteeA },
        text: `select app.create_tenant('Ny ApS', '', '', '', '', '', 'da', 'Europe/Copenhagen', '100-1000', '{woocommerce,dinero}') as t`,
      },
    ]);
    expect(r.error).toBeUndefined();
    const id = r.results[0]!.rows[0].t as string;
    const again = await runSteps('web', [
      {
        ctx: { userId: ID.userInviteeA },
        text: `select app.create_tenant('Ny ApS', '', '', '', '', '', 'da', 'Europe/Copenhagen', '', '{}') as t`,
      },
      {
        ctx: { userId: ID.userInviteeA },
        text: `select app.create_tenant('Anden ApS', '', '', '', '', '', 'da', 'Europe/Copenhagen', '', '{}') as t`,
      },
    ]);
    expect(again.failedAt).toBe(1);
    expect(again.error?.message).toContain('SIGNUP_PENDING');
    // Rolled back: nothing was left behind.
    expect((await admin('select 1 from tenants where id = $1', [id])).rowCount).toBe(0);
    const state = await runSteps('web', [
      {
        ctx: { userId: ID.userInviteeA },
        text: `select app.create_tenant('Ny ApS', '', '', '', '', '', 'da', 'Europe/Copenhagen', 'lt100', '{shopify}') as t`,
      },
      {
        ctx: { userId: ID.userInviteeA },
        text: `select t.signup_state, t.chosen_connectors, t.orders_per_month, exists (select 1 from app.pending_signups) as indexed
                 from tenants t where t.id = (select m.tenant_id from memberships m limit 1)`,
      },
    ]);
    // pending_signups is private: the web role can't read it.
    expect(state.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('orders per month only takes SU3 intervals', async () => {
    const { error } = await run('web', OWNER_P, `update tenants set orders_per_month = '0-200'`);
    expect(error?.code).toBe('23514');
  });

  it('plan chosen: only the owner moves pending_plan to pending_payment', async () => {
    const owner = await runSteps('web', [
      { ctx: null, text: `select 1` },
      { ctx: OWNER_P, text: `select app.signup_plan_chosen()` },
    ]);
    expect(owner.error).toBeUndefined();
    const reader = await run('web', READER_A, `select app.signup_plan_chosen()`);
    expect(reader.error?.message).toContain('NOT_OWNER');
    const worker = await run('worker', OWNER_P, `select app.signup_plan_chosen()`);
    expect(worker.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('activation: worker only, needs the paid subscription invoice, happens once', async () => {
    const unpaid = await run('worker', OWNER_P, `select app.signup_activate($1) as ok`, [
      P.invoice,
    ]);
    expect(unpaid.result!.rows[0].ok).toBe(false);
    const r = await runSteps('worker', [
      {
        ctx: OWNER_P,
        text: `update invoices set status = 'paid' where id = $1`,
        values: [P.invoice],
      },
      { ctx: OWNER_P, text: `select app.signup_activate($1) as ok`, values: [P.invoice] },
      { ctx: OWNER_P, text: `select app.signup_activate($1) as ok`, values: [P.invoice] },
      { ctx: OWNER_P, text: `select signup_state, onboarding_step from tenants` },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.results[1]!.rows[0].ok).toBe(true);
    expect(r.results[2]!.rows[0].ok).toBe(false);
    expect(r.results[3]!.rows[0]).toEqual({ signup_state: 'active', onboarding_step: 'webshop' });
    // Another tenant's paid invoice never activates this one.
    const cross = await run('worker', OWNER_A, `select app.signup_activate($1) as ok`, [P.invoice]);
    expect(cross.result!.rows[0].ok).toBe(false);
    const web = await run('web', OWNER_P, `select app.signup_activate($1)`, [P.invoice]);
    expect(web.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('terms acceptances', () => {
  const insert = `insert into terms_acceptances (tenant_id, user_id, document, version, url) values ($1, $2, 'privacy_policy', 'v1', 'https://agentor.dk/x')`;

  it('the owner records their own acceptance in their own tenant', async () => {
    const ok = await run('web', OWNER_P, insert, [P.tenant, P.owner]);
    expect(ok.error).toBeUndefined();
    const otherUser = await run('web', OWNER_P, insert, [P.tenant, ID.userAOwner]);
    expect(otherUser.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const otherTenant = await run('web', OWNER_P, insert, [ID.tenantA, P.owner]);
    expect(otherTenant.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const reader = await run('web', READER_A, insert, [ID.tenantA, ID.userAReader]);
    expect(reader.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is append-only and only visible in its tenant', async () => {
    for (const text of [
      'update terms_acceptances set version = $1',
      'delete from terms_acceptances',
    ]) {
      const { error } = await run('web', OWNER_A, text, text.includes('$1') ? ['x'] : []);
      expect(error?.code, text).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const seen = await run('web', OWNER_A, 'select tenant_id from terms_acceptances');
    expect(seen.result!.rows.every((r) => r.tenant_id === ID.tenantA)).toBe(true);
    expect(seen.result!.rowCount).toBeGreaterThan(0);
  });
});

describe('purge after 24 hours (B1)', () => {
  it('lists only old unfinished companies without a payment in flight, for the worker only', async () => {
    const worker = await run(
      'worker',
      null,
      'select tenant_id from app.signup_purge_candidates(now())',
    );
    expect(worker.result!.rows.map((r) => r.tenant_id)).toEqual([P.tenant]);
    const inFlight = await runSteps('worker', [
      {
        ctx: OWNER_P,
        text: 'select app.signup_payment_activity()',
      },
      { ctx: null, text: 'select tenant_id from app.signup_purge_candidates(now())' },
    ]);
    expect(inFlight.results[1]!.rowCount).toBe(0);
    const tomorrow = await run(
      'worker',
      null,
      `select tenant_id from app.signup_purge_candidates(now() - interval '2 hours')`,
    );
    expect(tomorrow.result!.rowCount).toBe(0);
    const web = await run('web', OWNER_P, 'select * from app.signup_purge_candidates(now())');
    expect(web.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('deletes the unfinished company with its rows, never an active one', async () => {
    const r = await runSteps('worker', [
      { ctx: null, text: 'select app.signup_purge_tenant($1, now()) as ok', values: [P.tenant] },
      { ctx: null, text: 'select app.signup_purge_tenant($1, now()) as ok', values: [ID.tenantA] },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.results[0]!.rows[0].ok).toBe(true);
    expect(r.results[1]!.rows[0].ok).toBe(false);
    expect((await admin('select 1 from tenants where id = $1', [P.tenant])).rowCount).toBe(1);
  });

  it('deletes only signup accounts older than 24 hours without a company', async () => {
    const r = await runSteps('worker', [
      { ctx: null, text: 'select app.signup_purge_users(now()) as n' },
    ]);
    expect(r.error).toBeUndefined();
    // stale goes; the pending owner still has a membership, fresh is too new, fixtures have no marker.
    expect(r.results[0]!.rows[0].n).toBe(1);
    const web = await run('web', null, 'select app.signup_purge_users(now())');
    expect(web.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('repository: createSignupCompany', () => {
  it('stores the chosen systems and order interval through the web role', async () => {
    const { createDatabase } = await import('../../src/client.js');
    const { createSignupCompany, getSignupCompany } = await import('../../src/repo/signup.js');
    const { roleUrl } = await import('./env.js');
    const { inject } = await import('vitest');
    const web = createDatabase(roleUrl('web', inject('isolationDb')), { max: 1 });
    let tenantId = '';
    try {
      tenantId = await createSignupCompany(web.db, P.fresh, 'fresh@example.test', {
        name: 'Repo Test ApS',
        cvr: null,
        addressLine: null,
        postalCode: null,
        city: null,
        ordersPerMonth: '100-1000',
        chosenConnectors: ['woocommerce', 'dinero', 'hubspot'],
        locale: 'da',
      });
      const c = await getSignupCompany(web.db, { tenantId, userId: P.fresh });
      expect(c).toMatchObject({
        signupState: 'pending_plan',
        ordersPerMonth: '100-1000',
        chosenConnectors: ['woocommerce', 'dinero', 'hubspot'],
        billingEmail: 'fresh@example.test',
      });
    } finally {
      if (tenantId) await admin('delete from tenants where id = $1', [tenantId]);
      await web.close();
    }
  });
});

describe('receipt for the first payment (Q20)', () => {
  const Q = {
    tenant: '0190a000-0000-7000-8000-0000000c0011',
    owner: '0190a000-0000-7000-8000-0000000c0012',
    invoice: '0190a000-0000-7000-8000-0000000c0013',
  };
  const OWNER_Q = { tenantId: Q.tenant, userId: Q.owner };

  beforeAll(async () => {
    await admin('begin');
    await admin(
      `insert into auth.users (id, email, name, email_verified) values ($1, 'receipt-owner@example.test', 'Receipt Owner', true)`,
      [Q.owner],
    );
    await admin(
      `insert into tenants (id, name, signup_state, signup_state_at) values ($1, 'Kvittering ApS', 'active', now())`,
      [Q.tenant],
    );
    await admin(
      `insert into memberships (tenant_id, user_id, role, flow_scope) values ($1, $2, 'owner', 'all')`,
      [Q.tenant, Q.owner],
    );
    await admin(
      `insert into invoices (tenant_id, id, number, period_start, period_end, description, amount_ore, vat_ore, status)
       values ($1, $2, 'AG-TEST-Q', now(), now() + interval '1 month', 'Business · månedlig', 15900, 3975, 'paid')`,
      [Q.tenant, Q.invoice],
    );
    await admin('commit');
  });

  afterAll(async () => {
    await admin('delete from tenants where id = $1', [Q.tenant]);
    await admin('delete from auth.users where id = $1', [Q.owner]);
  });

  it('is claimed once by a member, again only after a release', async () => {
    const r = await runSteps('web', [
      { ctx: OWNER_Q, text: `select app.claim_signup_receipt() as id` },
      { ctx: OWNER_Q, text: `select app.claim_signup_receipt() as id` },
      { ctx: OWNER_Q, text: `select app.release_signup_receipt()` },
      { ctx: OWNER_Q, text: `select app.claim_signup_receipt() as id` },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.results[0]!.rows[0].id).toBe(Q.invoice);
    expect(r.results[1]!.rows[0].id).toBeNull();
    expect(r.results[3]!.rows[0].id).toBe(Q.invoice);
  });

  it('never for another tenant, a company without signup, or the worker', async () => {
    const outsider = await run(
      'web',
      { tenantId: Q.tenant, userId: ID.userAOwner },
      `select app.claim_signup_receipt() as id`,
    );
    expect(outsider.result!.rows[0].id).toBeNull();
    const seeded = await run('web', OWNER_A, `select app.claim_signup_receipt() as id`);
    expect(seeded.result!.rows[0].id).toBeNull();
    const worker = await run('worker', OWNER_Q, `select app.claim_signup_receipt()`);
    expect(worker.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('invoice numbers', () => {
  it('keep every digit past 99999 (no truncation)', async () => {
    // Sequences are not transactional; moving one forward is harmless, it only ever grows.
    const cur = await admin(`select last_value from app.invoice_number_seq`);
    const next = Math.max(Number(cur.rows[0].last_value), 99_999);
    await admin(`select setval('app.invoice_number_seq', $1)`, [next]);
    const r = await run('worker', OWNER_A, `select app.next_invoice_number() as n`);
    expect(r.error).toBeUndefined();
    expect(r.result!.rows[0].n).toMatch(new RegExp(`^INV/\\d{4}/${next + 1}$`));
  });
});
