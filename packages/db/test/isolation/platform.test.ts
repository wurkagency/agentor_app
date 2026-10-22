import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminUrl } from './env.js';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE } from './helpers.js';

/**
 * Agentor Platform (M8): staff have no standing access to customer data; a support grant opens
 * one tenant, for a limited time, in the approved scope; customers see only their own cases and
 * never internal notes. Each test runs in one transaction that switches between the web role
 * (with a user/tenant context) and the superuser (to play the customer approving), then rolls back.
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

const makeStaff = (role = 'supporter'): Step => ({
  as: 'admin',
  sql: `insert into platform.staff (user_id, role) values ($1, $2)`,
  values: [STAFF, role],
});
const request = (scope = 'help', tenant = ID.tenantA): Step => ({
  as: 'web',
  user: STAFF,
  sql: `select grant_id from app.platform_request_access($1, 'Anne Support', null, '#1', 'Fejl i fakturaer', 8, $2)`,
  values: [tenant, scope],
});
const approve: Step = {
  as: 'admin',
  sql: `update support_access_grants set approved_at = now(), approved_by = $1 where staff_user_id = $2`,
  values: [ID.userAOwner, STAFF],
};
const asSupport = (sql: string, tenant: string = ID.tenantA): Step => ({
  as: 'web',
  user: STAFF,
  tenant,
  sql,
});

describe('staff without a grant', () => {
  it('see no customer data, only the customer list', async () => {
    const r = await steps([
      makeStaff('superadmin'),
      asSupport('select count(*)::int as n from flows'),
      asSupport('select count(*)::int as n from run_records'),
      { as: 'web', user: STAFF, sql: 'select count(*)::int as n from app.platform_customers()' },
      asSupport('select app.support_scope() as s'),
    ]);
    expect(r[1]!.rows![0]!.n).toBe(0);
    expect(r[2]!.rows![0]!.n).toBe(0);
    expect(r[3]!.rows![0]!.n).toBeGreaterThanOrEqual(2);
    expect(r[4]!.rows![0]!.s).toBeNull();
  });

  it('non-staff, including tenant owners, can call no platform function and read no platform table', async () => {
    const r = await steps([
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: 'select * from app.platform_customers()',
      },
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: 'select * from app.platform_error_codes(now())',
      },
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: 'select count(*)::int as n from platform.staff',
      },
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: 'select count(*)::int as n from platform.time_entries',
      },
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: `insert into platform.staff (user_id, role) values ($1, 'superadmin')`,
        values: [ID.userAOwner],
      },
    ]);
    expect(r[0]!.error?.message).toContain('NOT_STAFF');
    expect(r[1]!.error?.message).toContain('NOT_STAFF');
    expect(r[2]!.rows![0]!.n).toBe(0);
    expect(r[3]!.rows![0]!.n).toBe(0);
    expect(r[4]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('sitemap v2: Support › Adgange and Fejl (0046)', () => {
  it('non-staff can call neither function', async () => {
    const owner = { as: 'web' as const, user: ID.userAOwner, tenant: ID.tenantA };
    const r = await steps([
      { ...owner, sql: 'select * from app.platform_grants()' },
      {
        ...owner,
        sql: `select * from app.platform_error_codes_range(now() - interval '2 days', now() - interval '1 day', now())`,
      },
    ]);
    expect(r[0]!.error?.message).toContain('NOT_STAFF');
    expect(r[1]!.error?.message).toContain('NOT_STAFF');
  });

  it('lists every staff grant with its state, but only counts and names, never customer data', async () => {
    const r = await steps([
      makeStaff(),
      request(),
      { as: 'web', user: STAFF, sql: 'select * from app.platform_grants()' },
      approve,
      {
        as: 'web',
        user: STAFF,
        sql: 'select state, actions from app.platform_grants() where staff_user_id = $1',
        values: [STAFF],
      },
      {
        as: 'web',
        user: STAFF,
        sql: `select * from app.platform_error_codes_range(now() - interval '2 days', now() - interval '1 day', now())`,
      },
    ]);
    const rows = r[2]!.rows!.filter((x) => x.staff_user_id === STAFF);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.staff_user_id).toBe(STAFF);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'grant_id',
        'tenant_id',
        'tenant_name',
        'tenant_cvr',
        'staff_user_id',
        'staff_name',
        'case_id',
        'case_ref',
        'case_number',
        'case_title',
        'scope',
        'state',
        'approved_by_name',
        'requested_at',
        'approved_at',
        'expires_at',
        'closed_at',
        'extension_requested_at',
        'actions',
      ].sort(),
    );
    expect(r[4]!.rows![0]!.state).toBe('active');
    expect(r[5]!.error).toBeUndefined();
    expect(Object.keys(r[5]!.rows![0] ?? { error_code: 1 })).not.toContain('payload');
  });

  it("hides another staff member's direct Superadmin opening", async () => {
    const r = await steps([
      makeStaff(),
      {
        as: 'admin',
        sql: `insert into support_access_grants (tenant_id, case_ref, reason, support_name, staff_user_id, scope, hours, superadmin, approved_at, expires_at)
              values ($1, 'Superadmin', 'Direkte', 'Kasper', $2, 'help', 24, true, now(), now() + interval '1 hour')`,
        values: [ID.tenantA, ID.userAOwner],
      },
      {
        as: 'web',
        user: STAFF,
        sql: `select count(*)::int as n from app.platform_grants() where case_ref = 'Superadmin'`,
      },
    ]);
    expect(r[1]!.error).toBeUndefined();
    expect(r[2]!.rows![0]!.n).toBe(0);
  });
});

describe('Administration (0048, 0049): Superadmin only, versions read-only for runtime roles', () => {
  it('a Supporter can neither change prices, write incidents nor read the status counts', async () => {
    const sup = { as: 'web' as const, user: STAFF };
    const r = await steps([
      makeStaff('supporter'),
      {
        ...sup,
        sql: `select app.platform_price_version_create('business', 1, '{}'::jsonb, 'new', 'X')`,
      },
      {
        ...sup,
        sql: `insert into platform.incidents (kind, title, status, starts_at, created_by, created_by_name)
              values ('incident', 'X', 'investigating', now(), $1, 'X')`,
        values: [STAFF],
      },
      { ...sup, sql: 'select count(*)::int as n from platform.incidents' },
      { ...sup, sql: 'select * from app.platform_status_counts(now(), now())' },
      { ...sup, sql: 'select * from app.platform_connector_status()' },
      {
        ...sup,
        sql: `insert into platform.support_price_versions (rate_ore, rounding_minutes, effective_from, created_by_name)
              values (1, 15, now(), 'X')`,
      },
      { ...sup, sql: 'select count(*)::int as n from platform.support_price_versions' },
    ]);
    expect(r[1]!.error?.message).toContain('NOT_SUPERADMIN');
    expect(r[2]!.error).toBeDefined();
    expect(r[3]!.rows![0]!.n).toBe(0);
    expect(r[4]!.error?.message).toContain('NOT_SUPERADMIN');
    expect(r[5]!.error?.message).toContain('NOT_SUPERADMIN');
    expect(r[6]!.error).toBeDefined();
    // Staff read the support price (Tid pr. kunde shows the rate).
    expect(r[7]!.rows![0]!.n).toBeGreaterThan(0);
  });

  it('nobody writes plan_price_versions directly; Superadmin goes through the function', async () => {
    const r = await steps([
      makeStaff('superadmin'),
      {
        as: 'web',
        user: STAFF,
        sql: `insert into plan_price_versions (plan_id, price_monthly_ore, applies_to, effective_from, created_by_name)
              values ('business', 1, 'new', now(), 'X')`,
      },
      {
        as: 'web',
        user: STAFF,
        sql: `update plan_price_versions set price_monthly_ore = 1`,
      },
      {
        as: 'web',
        user: STAFF,
        sql: `select app.platform_price_version_create('business', 16900, '{}'::jsonb, 'new', 'Kasper') as id`,
      },
      {
        as: 'admin',
        sql: `select price_monthly_ore as p from plan_price_versions where plan_id = 'business'
               order by created_at desc limit 1`,
      },
      {
        as: 'worker',
        tenant: ID.tenantA,
        sql: 'select count(*)::int as n from plan_price_versions',
      },
    ]);
    expect(r[1]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(r[2]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(r[3]!.error).toBeUndefined();
    expect(r[4]!.rows![0]!.p).toBe(16900);
    expect(r[5]!.rows![0]!.n).toBeGreaterThan(0);
  });

  it('a new subscription gets the newest version; an existing one keeps its own', async () => {
    const r = await steps([
      {
        as: 'admin',
        sql: `select s.price_version_id as v from subscriptions s where s.tenant_id = $1`,
        values: [ID.tenantA],
      },
      makeStaff('superadmin'),
      {
        as: 'web',
        user: STAFF,
        sql: `select app.platform_price_version_create(
                (select plan_id from subscriptions where tenant_id = '${ID.tenantA}'), 12345, '{}'::jsonb, 'new', 'Kasper') as id`,
      },
      {
        as: 'admin',
        sql: `select s.price_version_id as v from subscriptions s where s.tenant_id = $1`,
        values: [ID.tenantA],
      },
      {
        as: 'admin',
        sql: `select app.subscription_version_at(s.price_version_id, s.plan_id, now() + interval '1 year') as v
                from subscriptions s where s.tenant_id = $1`,
        values: [ID.tenantA],
      },
    ]);
    expect(r[0]!.rows![0]!.v).toBeTruthy();
    expect(r[3]!.rows![0]!.v).toBe(r[0]!.rows![0]!.v);
    // "new" never moves an existing subscription, even at a later renewal.
    expect(r[4]!.rows![0]!.v).toBe(r[0]!.rows![0]!.v);
  });
});

describe('a support grant', () => {
  it('opens nothing until the customer approves', async () => {
    const r = await steps([
      makeStaff(),
      request(),
      asSupport('select count(*)::int as n from flows'),
    ]);
    expect(r[1]!.rows).toHaveLength(1);
    expect(r[2]!.rows![0]!.n).toBe(0);
  });

  it('"Se og hjælpe" edits flows like an Admin, but never team, audit log or connections', async () => {
    const r = await steps([
      makeStaff(),
      request('help'),
      approve,
      asSupport('select count(*)::int as n from flows'),
      asSupport(`update flows set name = name where id = '${ID.flowA1}'`),
      asSupport('select count(*)::int as n from audit_log'),
      asSupport(`update connections set name = 'x'`),
      asSupport(
        `insert into memberships (tenant_id, user_id, role) values ('${ID.tenantA}', '${STAFF}', 'owner')`,
      ),
      asSupport('select app.is_tenant_admin() as a'),
    ]);
    expect(r[3]!.rows![0]!.n).toBeGreaterThan(0);
    expect(r[4]!.rowCount).toBe(1);
    expect(r[5]!.rows![0]!.n).toBe(0);
    expect(r[6]!.rowCount ?? 0).toBe(0);
    expect(r[7]!.error).toBeDefined();
    expect(r[8]!.rows![0]!.a).toBe(false);
  });

  it('"Kun se" reads but changes nothing', async () => {
    const r = await steps([
      makeStaff(),
      request('view'),
      approve,
      asSupport('select count(*)::int as n from flows'),
      asSupport(`update flows set name = name where id = '${ID.flowA1}'`),
    ]);
    expect(r[3]!.rows![0]!.n).toBeGreaterThan(0);
    expect(r[4]!.rowCount ?? 0).toBe(0);
  });

  it('opens only its own tenant, and stops when ended or expired', async () => {
    const r = await steps([
      makeStaff(),
      request('help'),
      approve,
      asSupport('select count(*)::int as n from flows', ID.tenantB),
      {
        as: 'admin',
        sql: `update support_access_grants set expires_at = now() - interval '1 second' where staff_user_id = $1`,
        values: [STAFF],
      },
      asSupport('select count(*)::int as n from flows'),
    ]);
    expect(r[3]!.rows![0]!.n).toBe(0);
    expect(r[5]!.rows![0]!.n).toBe(0);
  });

  it('needs a known scope, 1/8/24 hours and a reason', async () => {
    const r = await steps([
      makeStaff(),
      {
        as: 'web',
        user: STAFF,
        sql: `select * from app.platform_request_access($1, 'A', null, '#1', ' ', 8, 'help')`,
        values: [ID.tenantA],
      },
      {
        as: 'web',
        user: STAFF,
        sql: `select * from app.platform_request_access($1, 'A', null, '#1', 'x', 48, 'help')`,
        values: [ID.tenantA],
      },
      {
        as: 'web',
        user: STAFF,
        sql: `select * from app.platform_request_access($1, 'A', null, '#1', 'x', 8, 'admin')`,
        values: [ID.tenantA],
      },
    ]);
    expect(r[1]!.error?.message).toContain('SUPPORT_CASE_AND_REASON_REQUIRED');
    expect(r[2]!.error?.message).toContain('SUPPORT_HOURS');
    expect(r[3]!.error?.message).toContain('SUPPORT_SCOPE');
  });
});

describe('support cases', () => {
  const openCase = (tenant: string, user: string): Step => ({
    as: 'web',
    user,
    tenant,
    sql: `insert into platform.cases (tenant_id, title, created_by_user_id, created_by_name) values ($1, 'Hjælp', $2, 'Kunde') returning id`,
    values: [tenant, user],
  });

  it('customers open and see their own cases, never other tenants’ or internal notes', async () => {
    const r = await steps([
      makeStaff(),
      openCase(ID.tenantA, ID.userAReader),
      openCase(ID.tenantB, ID.userBOwner),
      {
        as: 'admin',
        sql: `insert into platform.case_events (case_id, tenant_id, kind, author_name, body)
              select id, tenant_id, k, 'Anne', 'x' from platform.cases, unnest(array['reply','internal_note','session']) k`,
      },
      {
        as: 'web',
        user: ID.userAReader,
        tenant: ID.tenantA,
        sql: 'select count(*)::int as n from platform.cases',
      },
      {
        as: 'web',
        user: ID.userAReader,
        tenant: ID.tenantA,
        sql: `select kind from platform.case_events order by kind`,
      },
      {
        as: 'web',
        user: ID.userAReader,
        tenant: ID.tenantA,
        sql: `insert into platform.case_events (case_id, tenant_id, kind, author_user_id, author_name, body)
              select id, tenant_id, 'internal_note', $1, 'Kunde', 'x' from platform.cases limit 1`,
        values: [ID.userAReader],
      },
      {
        as: 'web',
        user: ID.userAReader,
        tenant: ID.tenantA,
        sql: `update platform.cases set status = 'resolved'`,
      },
      { as: 'web', user: STAFF, sql: 'select count(*)::int as n from platform.cases' },
    ]);
    expect(r[1]!.rows).toHaveLength(1);
    expect(r[4]!.rows![0]!.n).toBe(1);
    expect(r[5]!.rows!.map((x) => x.kind)).toEqual(['reply']);
    expect(r[6]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(r[7]!.rowCount ?? 0).toBe(0);
    expect(r[8]!.rows![0]!.n).toBe(2);
  });
});

describe('support time on invoices', () => {
  it('the worker sees only the current customer’s time entries', async () => {
    const r = await steps([
      {
        as: 'admin',
        sql: `insert into platform.time_entries (staff_user_id, staff_name, tenant_id, work_date, minutes, kind, source, billable)
              values ($1, 'Anne', $2, current_date, 30, 'phone', 'manual', true),
                     ($1, 'Anne', $3, current_date, 45, 'phone', 'manual', true)`,
        values: [STAFF, ID.tenantA, ID.tenantB],
      },
      {
        as: 'worker',
        tenant: ID.tenantA,
        sql: 'select sum(minutes)::int as m from platform.time_entries',
      },
    ]);
    expect(r[1]!.rows![0]!.m).toBe(30);
  });
});

describe('Superadmin opens a customer directly (decision of 19 Oct 2026)', () => {
  const superadmin: Step = {
    as: 'admin',
    sql: `insert into platform.staff (user_id, role) values ($1, 'superadmin')`,
    values: [STAFF],
  };
  const open: Step = {
    as: 'web',
    user: STAFF,
    sql: `select app.platform_superadmin_open($1, 'Kasper') as id`,
    values: [ID.tenantA],
  };

  it('a Supporter cannot open directly', async () => {
    const r = await steps([makeStaff('supporter'), open]);
    expect(r[1]!.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('Superadmin gets help scope at once, logged at the customer, with no notification', async () => {
    const r = await steps([
      superadmin,
      open,
      open,
      asSupport('select app.support_scope() as scope'),
      {
        as: 'admin',
        sql: `select count(*)::int as n from audit_log where tenant_id = $1 and action = 'support.superadmin_opened'`,
        values: [ID.tenantA],
      },
      {
        as: 'admin',
        sql: `select count(*)::int as n from notifications where tenant_id = $1 and event = 'support_requested'`,
        values: [ID.tenantA],
      },
      asSupport('select app.support_scope() as scope', ID.tenantB),
    ]);
    // Opening twice reuses the same grant.
    expect(r[1]!.rows![0]!.id).toBe(r[2]!.rows![0]!.id);
    expect(r[3]!.rows![0]!.scope).toBe('help');
    expect(r[4]!.rows![0]!.n).toBe(1);
    expect(r[5]!.rows![0]!.n).toBe(0);
    // Only the customer that was opened.
    expect(r[6]!.rows![0]!.scope).toBeNull();
  });
});

describe('create a customer (Superadmin, /platform/customers)', () => {
  const TOKEN = 'a'.repeat(43);
  const create = (user: string, email = 'ejer@nordlys-cykler.test'): Step => ({
    as: 'web',
    user,
    sql: `select app.platform_create_customer('Nordlys Test ApS', '', '', '', '', '', $1, 'business', 'year', $2, 'Kasper') as id`,
    values: [email, TOKEN],
  });

  it('a superadmin creates it waiting for payment, with an owner invitation and no purge', async () => {
    const r = await steps([
      makeStaff('superadmin'),
      create(STAFF),
      {
        as: 'admin',
        sql: `select t.signup_state, s.plan_id, s.interval, s.status, i.role, i.email,
                     (select count(*)::int from app.pending_signups p where p.tenant_id = t.id) as pending,
                     (select count(*)::int from memberships m where m.tenant_id = t.id) as members
                from tenants t join subscriptions s on s.tenant_id = t.id
                join invitations i on i.tenant_id = t.id where t.name = 'Nordlys Test ApS'`,
      },
    ]);
    expect(r[1]!.error).toBeUndefined();
    expect(r[2]!.rows![0]).toEqual({
      signup_state: 'pending_payment',
      plan_id: 'business',
      interval: 'year',
      status: 'incomplete',
      role: 'owner',
      email: 'ejer@nordlys-cykler.test',
      pending: 0,
      members: 0,
    });
  });

  it('a supporter, a customer and a bad e-mail are refused', async () => {
    const r = await steps([
      makeStaff('supporter'),
      create(STAFF),
      create(ID.userAOwner),
      {
        as: 'admin',
        sql: `update platform.staff set role = 'superadmin' where user_id = $1`,
        values: [STAFF],
      },
      create(STAFF, 'not-an-email'),
    ]);
    expect(r[1]!.error?.message).toContain('NOT_SUPERADMIN');
    expect(r[2]!.error?.message).toContain('NOT_SUPERADMIN');
    expect(r[4]!.error?.message).toContain('OWNER_EMAIL_INVALID');
  });

  it('a tenant admin can never invite an owner', async () => {
    const r = await steps([
      {
        as: 'web',
        user: ID.userAOwner,
        tenant: ID.tenantA,
        sql: `insert into invitations (tenant_id, email, role, token_hash, expires_at, invited_by)
              values ($1, 'ny-ejer@example.test', 'owner', $2, now() + interval '1 day', $3)`,
        values: [ID.tenantA, 'b'.repeat(43), ID.userAOwner],
      },
    ]);
    expect(r[0]!.error?.message).toContain('OWNER_INVITATION_PROTECTED');
  });
});

describe('customer administration (0053): Super Administrator only', () => {
  const TOKEN = 'b'.repeat(43);
  const call = (user: string, sql: string, values: unknown[] = []): Step => ({
    as: 'web',
    user,
    sql,
    values,
  });

  it('a Support Agent and a tenant owner can call none of the functions', async () => {
    const fns = [
      `select app.platform_customer_update($1, 'X', '', '', '', '', '', 'X')`,
      `select app.platform_customer_set_status($1, 'suspended', 'X', 'X')`,
      `select app.platform_customer_resend_owner_invitation($1, '', '${TOKEN}', 'X')`,
      `select app.platform_customer_delete($1, 'X')`,
      `select app.platform_customer_admin_info($1)`,
    ];
    const r = await steps([
      makeStaff('supporter'),
      ...fns.map((sql) => call(STAFF, sql, [ID.tenantA])),
      ...fns.map((sql) => ({ ...call(ID.userAOwner, sql, [ID.tenantA]), tenant: ID.tenantA })),
    ]);
    for (const x of r.slice(1)) expect(x.error?.message).toContain('NOT_SUPERADMIN');
  });

  it('suspends with a reason, keeps invoiced customers, and deletes a new one', async () => {
    const r = await steps([
      makeStaff('superadmin'),
      call(STAFF, `select app.platform_customer_set_status($1, 'suspended', '', 'Kasper')`, [
        ID.tenantA,
      ]),
      call(STAFF, `select app.platform_customer_set_status($1, 'suspended', 'Test', 'Kasper')`, [
        ID.tenantA,
      ]),
      { as: 'admin', sql: `select status from tenants where id = $1`, values: [ID.tenantA] },
      call(STAFF, `select app.platform_customer_delete($1, 'wrong')`, [ID.tenantA]),
      {
        as: 'admin',
        sql: `select name from tenants where id = $1`,
        values: [ID.tenantA],
      },
      call(
        STAFF,
        `select app.platform_create_customer('Slet Mig ApS', '', '', '', '', '', 'slet@x.test', 'business', 'month', $1, 'Kasper') as id`,
        [TOKEN],
      ),
      {
        as: 'admin',
        user: STAFF,
        sql: `select app.platform_customer_delete((select id from tenants where name = 'Slet Mig ApS'), 'slet mig aps') as name`,
      },
      { as: 'admin', sql: `select count(*)::int as n from tenants where name = 'Slet Mig ApS'` },
    ]);
    expect(r[1]!.error?.message).toContain('REASON_REQUIRED');
    expect(r[2]!.error).toBeUndefined();
    expect(r[3]!.rows![0]!.status).toBe('suspended');
    expect(r[4]!.error?.message).toContain('CONFIRM_NAME_MISMATCH');
    const tenantAName = r[5]!.rows![0]!.name as string;
    expect(r[7]!.rows![0]!.name).toBe('Slet Mig ApS');
    expect(r[8]!.rows![0]!.n).toBe(0);
    // An invoiced customer can't be deleted, even with the right name.
    const invoiced = await steps([
      makeStaff('superadmin'),
      call(STAFF, `select app.platform_customer_delete($1, $2)`, [ID.tenantA, tenantAName]),
    ]);
    expect(invoiced[1]!.error?.message).toContain('HAS_INVOICES');
  });
});
