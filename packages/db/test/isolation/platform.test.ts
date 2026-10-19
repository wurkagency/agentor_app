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
