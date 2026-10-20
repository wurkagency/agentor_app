import { describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

/** M4: subscriptions, invoices, onboarding and the billing indexes. */

const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };

describe('subscriptions and invoices', () => {
  it('every member sees the plan, only owners see invoices', async () => {
    const plan = await run('web', READER_A, 'select plan_id from subscriptions');
    expect(plan.result!.rows).toEqual([{ plan_id: 'business' }]);
    const readerInvoices = await run('web', READER_A, 'select 1 from invoices');
    expect(readerInvoices.result!.rowCount).toBe(0);
    const ownerInvoices = await run('web', OWNER_A, 'select number from invoices');
    expect(ownerInvoices.result!.rows).toEqual([{ number: 'AG-TEST-A' }]);
  });

  it('only owners change the plan, and only plan columns', async () => {
    const reader = await run('web', READER_A, `update subscriptions set plan_id = 'enterprise'`);
    expect(reader.result?.rowCount ?? 0).toBe(0);
    const owner = await run('web', OWNER_A, `update subscriptions set plan_id = 'enterprise'`);
    expect(owner.result!.rowCount).toBe(1);
    const status = await run('web', OWNER_A, `update subscriptions set status = 'active'`);
    expect(status.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const card = await run('web', OWNER_A, `update subscriptions set card_last4 = '0000'`);
    expect(card.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('web cannot create invoices or touch usage counters', async () => {
    const inv = await run(
      'web',
      OWNER_A,
      `insert into invoices (tenant_id, number, period_start, period_end, description, amount_ore, vat_ore)
       values ($1, 'X', now(), now(), 'x', 0, 0)`,
      [ID.tenantA],
    );
    expect(inv.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const usage = await run('web', OWNER_A, `update usage_counters set transactions = 0`);
    expect(usage.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('private billing indexes', () => {
  it('no runtime role can read them directly', async () => {
    for (const role of ['web', 'worker', 'support', 'ops'] as const) {
      for (const t of ['app.billing_schedule', 'app.billing_refs']) {
        const { error } = await run(role, OWNER_A, `select 1 from ${t}`);
        expect(error?.code, `${role} ${t}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    }
  });

  it('due subscriptions are listed for the worker only, without exposing other data', async () => {
    const worker = await run('worker', null, 'select * from app.due_subscriptions(now())');
    expect(worker.result!.rows.map((r) => r.due_subscriptions)).toEqual([ID.tenantA]);
    const web = await run('web', OWNER_A, 'select * from app.due_subscriptions(now())');
    expect(web.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('billing refs are registered in the current tenant and resolved by the worker', async () => {
    const reg = await run(
      'web',
      OWNER_A,
      `select app.register_billing_ref('AGTEST123456', 'subscription', $1)`,
      [ID.tenantA],
    );
    expect(reg.error).toBeUndefined();
    const noCtx = await run(
      'web',
      null,
      `select app.register_billing_ref('AGTEST654321', 'subscription', $1)`,
      [ID.tenantA],
    );
    expect(noCtx.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const webResolve = await run(
      'web',
      OWNER_A,
      `select * from app.resolve_billing_ref('AGTEST123456')`,
    );
    expect(webResolve.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('invoice numbers come from one sequence in AG-YYYY-NNNN format', async () => {
    const { result } = await run('worker', null, 'select app.next_invoice_number() as n');
    expect(result!.rows[0].n).toMatch(/^AG-\d{4}-\d{4,}$/);
  });
});

describe('onboarding: create_tenant', () => {
  it('a signed-in user creates a company and becomes its owner', async () => {
    const { result, error } = await run(
      'web',
      { userId: ID.userInviteeA },
      `select app.create_tenant('Ny Butik ApS', '11223344', '', '', 'Odense', '', 'da', 'Europe/Copenhagen', 'lt100', '{woocommerce}') as t`,
    );
    expect(error).toBeUndefined();
    expect(result!.rows[0].t).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('needs a user and a name, and is not available to other roles', async () => {
    const noUser = await run(
      'web',
      null,
      `select app.create_tenant('X', '', '', '', '', '', 'da', 'Europe/Copenhagen', '', '{}')`,
    );
    expect(noUser.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const noName = await run(
      'web',
      { userId: ID.userInviteeA },
      `select app.create_tenant(' ', '', '', '', '', '', 'da', 'Europe/Copenhagen', '', '{}')`,
    );
    expect(noName.error?.message).toContain('TENANT_NAME_REQUIRED');
    for (const role of ['worker', 'support'] as const) {
      const { error } = await run(
        role,
        { userId: ID.userInviteeA },
        `select app.create_tenant('X', '', '', '', '', '', 'da', 'Europe/Copenhagen', '', '{}')`,
      );
      expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
