import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminUrl } from './env.js';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE } from './helpers.js';

/**
 * Finans (M9): only Superadmin reads subscriptions and invoices across customers, and only
 * through the app.platform_finance_* functions. Supporters and customers get nothing; changes
 * land in the customer's audit log. Each test runs in one rolled-back transaction.
 */

const STAFF = '0190a000-0000-7000-8000-0000000f0001';
let c: pg.Client;

beforeAll(async () => {
  c = new pg.Client({ connectionString: adminUrl(inject('isolationDb')) });
  await c.connect();
});
afterAll(() => c.end());

type Step = {
  as: 'web' | 'worker' | 'admin';
  user?: string;
  tenant?: string;
  sql: string;
  values?: unknown[];
};

async function steps(list: Step[]) {
  const out: {
    rows?: Record<string, unknown>[];
    rowCount?: number | null;
    error?: pg.DatabaseError;
  }[] = [];
  await c.query('begin');
  try {
    for (const s of list) {
      await c.query('reset role');
      await c.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
        [s.tenant ?? '', s.user ?? ''],
      );
      if (s.as !== 'admin') await c.query(`set local role agentor_${s.as}`);
      await c.query('savepoint s');
      try {
        const r = await c.query(s.sql, s.values ?? []);
        out.push({ rows: r.rows, rowCount: r.rowCount });
      } catch (error) {
        await c.query('rollback to savepoint s');
        if (!(error instanceof pg.DatabaseError)) throw error;
        out.push({ error });
      }
    }
  } finally {
    await c.query('rollback');
  }
  return out;
}

const staff = (role: 'superadmin' | 'supporter'): Step => ({
  as: 'admin',
  sql: `insert into platform.staff (user_id, role) values ($1, $2)`,
  values: [STAFF, role],
});
const asStaff = (sql: string, values: unknown[] = []): Step => ({
  as: 'web',
  user: STAFF,
  sql,
  values,
});
const entry: Step = {
  as: 'admin',
  sql: `with c as (insert into platform.cases (tenant_id, title, created_by_name) values ($2, 'Fejl', 'Anne') returning id)
        insert into platform.time_entries (staff_user_id, staff_name, tenant_id, case_id, work_date, minutes, kind, source, billable)
        select $1, 'Anne', $2, c.id, current_date, 10, 'phone', 'manual', true from c returning id`,
  values: [STAFF, ID.tenantA],
};
const draft = (net = 16000) =>
  asStaff(
    `select app.platform_finance_save_draft($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
       'Support', '[]'::jsonb, $2, $3, coalesce((select array_agg(id) from platform.time_entries), '{}'), now() + interval '1 hour') as id`,
    [ID.tenantA, net, net / 4],
  );

describe('finance reads', () => {
  it('Superadmin sees every customer’s subscriptions and invoices', async () => {
    const r = await steps([
      staff('superadmin'),
      asStaff(`select s->>'tenant_name' as name from app.platform_finance_subscriptions() s`),
      asStaff(
        `select i->>'number' as number from app.platform_finance_invoices('2000-01-01', '2100-01-01') i`,
      ),
    ]);
    expect(r[1]!.rows!).toHaveLength(2);
    expect(r[2]!.rows!.map((x) => x.number).sort()).toEqual(['AG-TEST-A', 'AG-TEST-B']);
  });

  it('a Supporter and a customer owner are refused', async () => {
    const r = await steps([
      staff('supporter'),
      asStaff(`select * from app.platform_finance_subscriptions()`),
      asStaff(`select * from app.platform_finance_invoices('2000-01-01', '2100-01-01')`),
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: `select * from app.platform_finance_subscriptions()`,
      },
    ]);
    for (const i of [1, 2, 3]) expect(r[i]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('nobody reads the private invoice schedule directly', async () => {
    const r = await steps([
      staff('superadmin'),
      asStaff('select * from app.invoice_schedule'),
      { as: 'worker', tenant: ID.tenantA, sql: 'select * from app.invoice_schedule' },
    ]);
    expect(r[1]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(r[2]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('support drafts', () => {
  it('Superadmin drafts, the time is linked, and the other customer never sees it', async () => {
    const r = await steps([
      staff('superadmin'),
      entry,
      draft(),
      {
        as: 'admin',
        sql: `select count(*)::int as n from platform.time_entries where invoice_id is not null`,
      },
      {
        as: 'web',
        user: ID.userBOwner,
        tenant: ID.tenantB,
        sql: `select count(*)::int as n from invoices where kind = 'support'`,
      },
      { as: 'admin', sql: `select status, number from invoices where kind = 'support'` },
    ]);
    expect(r[2]!.rows![0]!.id).toBeTruthy();
    expect(r[3]!.rows![0]!.n).toBe(1);
    expect(r[4]!.rows![0]!.n).toBe(0);
    expect(r[5]!.rows![0]).toEqual({ status: 'draft', number: null });
  });

  it('a Supporter cannot draft, approve, remind or give a discount', async () => {
    const r = await steps([
      staff('supporter'),
      draft(),
      asStaff(`select app.platform_finance_approve($1, gen_random_uuid(), 'Anne')`, [ID.tenantA]),
      asStaff(`select app.platform_finance_discount($1, 50, null, 'Anne')`, [ID.tenantA]),
      asStaff(
        `select * from app.platform_finance_notify($1, gen_random_uuid(), 'reminder', 'Anne')`,
        [ID.tenantA],
      ),
    ]);
    for (const i of [1, 2, 3, 4]) expect(r[i]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('an approved draft is scheduled for its send time and no longer changes', async () => {
    const t = await steps([
      staff('superadmin'),
      entry,
      draft(16000),
      {
        as: 'admin',
        sql: `select set_config('test.invoice', (select id::text from invoices where kind = 'support'), true)`,
      },
      asStaff(
        `select app.platform_finance_approve($1, current_setting('test.invoice')::uuid, 'Kasper')`,
        [ID.tenantA],
      ),
      draft(99000),
      {
        as: 'admin',
        sql: `select amount_ore, approved_by_name from invoices where kind = 'support'`,
      },
      { as: 'worker', sql: `select job from app.due_invoice_jobs(now())` },
      { as: 'worker', sql: `select job from app.due_invoice_jobs(now() + interval '2 hours')` },
    ]);
    expect(t[4]!.error).toBeUndefined();
    expect(t[6]!.rows![0]).toEqual({ amount_ore: 16000, approved_by_name: 'Kasper' });
    expect(t[7]!.rows!).toHaveLength(0);
    expect(t[8]!.rows!.map((x) => x.job)).toEqual(['send']);
  });
});

describe('finance changes are audited at the customer', () => {
  it('a discount and a reminder are written to the customer’s audit log', async () => {
    const r = await steps([
      staff('superadmin'),
      asStaff(
        `select app.platform_finance_discount($1, 20, now() + interval '3 months', 'Kasper')`,
        [ID.tenantA],
      ),
      asStaff(
        `select reminders from app.platform_finance_notify($1,
           (select (i->>'id')::uuid from app.platform_finance_invoices('2000-01-01', '2100-01-01') i
             where i->>'number' = 'AG-TEST-A'), 'reminder', 'Kasper')`,
        [ID.tenantA],
      ),
      {
        as: 'admin',
        sql: `select action, actor_name from audit_log
               where tenant_id = $1 and action in ('subscription.discount', 'invoice.reminder_sent')
               order by action`,
        values: [ID.tenantA],
      },
      {
        as: 'admin',
        sql: `select discount_pct from subscriptions where tenant_id = $1`,
        values: [ID.tenantA],
      },
    ]);
    expect(r[2]!.rows![0]!.reminders).toBe(1);
    expect(r[3]!.rows!).toEqual([
      { action: 'invoice.reminder_sent', actor_name: 'Agentor · Kasper' },
      { action: 'subscription.discount', actor_name: 'Agentor · Kasper' },
    ]);
    expect(r[4]!.rows![0]!.discount_pct).toBe(20);
  });
});
