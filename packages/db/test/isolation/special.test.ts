import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { checkRls } from '../../src/check-rls.js';
import { createDatabase, TenantContextError, withTenant } from '../../src/client.js';
import { flows } from '../../src/schema/index.js';
import { adminUrl, roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin, INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

const A_OWNER = { tenantId: ID.tenantA, userId: ID.userAOwner };

describe('structure', () => {
  it('passes the RLS structure check', async () => {
    const c = new pg.Client({ connectionString: adminUrl(inject('isolationDb')) });
    await c.connect();
    try {
      expect(await checkRls(c)).toEqual([]);
    } finally {
      await c.end();
    }
  });
});

describe('tenants', () => {
  it('shows only the current tenant', async () => {
    for (const role of ['web', 'worker'] as const) {
      const { result } = await run(role, A_OWNER, 'select id from tenants');
      expect(result!.rows.map((r) => r.id)).toEqual([ID.tenantA]);
    }
  });

  it('cannot create a tenant other than the current one', async () => {
    const { error } = await run('web', A_OWNER, `insert into tenants (id, name) values ($1, 'X')`, [
      crypto.randomUUID(),
    ]);
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot rename tenant B', async () => {
    const { result } = await run(
      'web',
      A_OWNER,
      `update tenants set name = 'pwned' where id = $1`,
      [ID.tenantB],
    );
    expect(result!.rowCount).toBe(0);
  });
});

describe('identity and pre-tenant visibility (ADR 0004)', () => {
  it('shows a shared user only the memberships of the current tenant', async () => {
    const { result } = await run(
      'web',
      { tenantId: ID.tenantA, userId: ID.userShared },
      'select tenant_id from memberships where user_id = $1',
      [ID.userShared],
    );
    expect(result!.rows.map((r) => r.tenant_id)).toEqual([ID.tenantA]);
  });

  it('before a tenant is chosen, a user sees only their own memberships and tenants', async () => {
    const shared = { userId: ID.userShared };
    const m = await run('web', shared, 'select tenant_id, user_id from memberships');
    expect(m.result!.rows.every((r) => r.user_id === ID.userShared)).toBe(true);
    expect(m.result!.rows.map((r) => r.tenant_id).sort()).toEqual([ID.tenantA, ID.tenantB].sort());
    const t = await run('web', shared, 'select id from tenants');
    expect(t.result!.rows.map((r) => r.id).sort()).toEqual([ID.tenantA, ID.tenantB].sort());

    const ownerB = { userId: ID.userBOwner };
    const tb = await run('web', ownerB, 'select id from tenants');
    expect(tb.result!.rows.map((r) => r.id)).toEqual([ID.tenantB]);
  });

  it('own-membership visibility switches off once a tenant is chosen', async () => {
    const { result } = await run(
      'web',
      { tenantId: ID.tenantB, userId: ID.userAOwner },
      'select tenant_id from memberships where user_id = $1',
      [ID.userAOwner],
    );
    expect(result!.rowCount).toBe(0);
  });

  it('without a user and without a tenant, nothing is visible', async () => {
    for (const table of ['memberships', 'tenants']) {
      const { result } = await run('web', {}, `select 1 from ${table}`);
      expect(result!.rowCount, table).toBe(0);
    }
  });

  it('only the web role can reach the auth schema', async () => {
    const { result } = await run('web', null, 'select count(*)::int as n from auth.users');
    expect(result!.rows[0].n).toBeGreaterThan(0);
    for (const role of ['worker', 'support', 'ops'] as const) {
      for (const table of [
        'users',
        'sessions',
        'accounts',
        'two_factors',
        'passkeys',
        'verifications',
      ]) {
        const { error } = await run(
          role,
          { tenantId: ID.tenantA },
          `select 1 from auth.${table} limit 1`,
        );
        expect(error?.code, `${role} auth.${table}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    }
  });
});

describe('key box', () => {
  it('web cannot read connection_secrets or tenant_keys', async () => {
    for (const table of ['connection_secrets', 'tenant_keys']) {
      const { error } = await run('web', A_OWNER, `select * from ${table}`);
      expect(error?.code, table).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('web can insert a secret for its own connection through the insert-only function', async () => {
    const { result, error } = await run(
      'web',
      A_OWNER,
      `select app.insert_connection_secret($1, 'test', null, '\\x00', '\\xcc') as r`,
      [ID.connA],
    );
    expect(error).toBeUndefined();
    expect(result!.rows[0].r).toBe(''); // void: nothing comes back
  });

  it('web cannot attach a secret to another tenant’s connection', async () => {
    const { error } = await run(
      'web',
      A_OWNER,
      `select app.insert_connection_secret($1, 'test', null, '\\x00', '\\xcc')`,
      [ID.connB],
    );
    expect(error?.code).toBe('23503'); // (tenant A, connection B) does not exist
  });

  it('the insert function refuses to run without tenant context', async () => {
    const { error } = await run(
      'web',
      null,
      `select app.insert_connection_secret($1, 'test', null, '\\x00', '\\xcc')`,
      [ID.connA],
    );
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('worker reads only the current tenant’s secrets', async () => {
    const { result } = await run(
      'worker',
      { tenantId: ID.tenantA },
      'select id from connection_secrets',
    );
    expect(result!.rows.map((r) => r.id)).toEqual([ID.secretA]);
  });
});

describe('audit log', () => {
  it('is append-only for web and worker', async () => {
    for (const role of ['web', 'worker'] as const) {
      const ctx = role === 'web' ? A_OWNER : { tenantId: ID.tenantA };
      const upd = await run(role, ctx, `update audit_log set action = 'x'`);
      expect(upd.error?.code, `${role} update`).toBe(INSUFFICIENT_PRIVILEGE);
      const del = await run(role, ctx, 'delete from audit_log');
      expect(del.error?.code, `${role} delete`).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('accepts inserts for the current tenant', async () => {
    const { error } = await run(
      'web',
      A_OWNER,
      `insert into audit_log (tenant_id, actor_kind, action, object_type) values ($1, 'user', 'x', 'y')`,
      [ID.tenantA],
    );
    expect(error).toBeUndefined();
  });
});

describe('per-flow access (web role)', () => {
  const DEV = { tenantId: ID.tenantA, userId: ID.userADevRestricted };

  it('a restricted user sees only granted, unexpired flows', async () => {
    const { result } = await run('web', DEV, 'select id from flows');
    expect(result!.rows.map((r) => r.id)).toEqual([ID.flowA1]);
  });

  it('a restricted user sees only their own grants', async () => {
    const { result } = await run('web', DEV, 'select id from flow_grants order by id');
    expect(result!.rows.map((r) => r.id)).toEqual([ID.grantA1, ID.grantA2Expired]);
  });

  it('a restricted user cannot create flows or grants', async () => {
    const flow = await run('web', DEV, `insert into flows (tenant_id, name) values ($1, 'x')`, [
      ID.tenantA,
    ]);
    expect(flow.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const grant = await run(
      'web',
      DEV,
      `insert into flow_grants (tenant_id, membership_id, flow_id) values ($1, $2, $3)`,
      [ID.tenantA, ID.memADevRestricted, ID.flowA2],
    );
    expect(grant.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('a restricted user cannot update a flow they have no grant for', async () => {
    const { result } = await run('web', DEV, `update flows set name = 'x' where id = $1`, [
      ID.flowA2,
    ]);
    expect(result!.rowCount).toBe(0);
  });

  it('a reader with access to all flows sees all flows of the tenant', async () => {
    const { result } = await run(
      'web',
      { tenantId: ID.tenantA, userId: ID.userAReader },
      'select id from flows',
    );
    expect(result!.rows.map((r) => r.id).sort()).toEqual([ID.flowA1, ID.flowA2].sort());
  });

  it('a user without membership in the tenant sees no flows', async () => {
    const { result } = await run(
      'web',
      { tenantId: ID.tenantA, userId: ID.userBOwner },
      'select id from flows',
    );
    expect(result!.rowCount).toBe(0);
  });

  it('web without a user sees no flows', async () => {
    const { result } = await run('web', { tenantId: ID.tenantA }, 'select id from flows');
    expect(result!.rowCount).toBe(0);
  });

  it('the worker is not limited by flow grants', async () => {
    const { result } = await run('worker', { tenantId: ID.tenantA }, 'select id from flows');
    expect(result!.rowCount).toBe(2);
  });
});

describe('support and ops roles', () => {
  it('agentor_support cannot read any table', async () => {
    const { rows } = await admin(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { relname } of rows) {
      // Schema-qualified: without USAGE on public, unqualified names don't even resolve.
      const { error } = await run('support', A_OWNER, `select 1 from public.${relname} limit 1`);
      expect(error?.code, relname).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('agentor_readonly_ops can read the plan catalogue but no tenant table', async () => {
    const plans = await run('ops', null, 'select id from plans');
    expect(plans.result!.rowCount).toBe(3);
    for (const table of inject('tenantTables')) {
      const { error } = await run('ops', A_OWNER, `select 1 from ${table} limit 1`);
      expect(error?.code, table).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe('withTenant()', () => {
  it('scopes queries to the tenant and leaves no context on the pooled connection', async () => {
    const handle = createDatabase(roleUrl('web', inject('isolationDb')), { max: 1 });
    try {
      const inside = await withTenant(handle.db, A_OWNER, (tx) =>
        tx.select({ id: flows.id }).from(flows),
      );
      expect(inside.map((r) => r.id).sort()).toEqual([ID.flowA1, ID.flowA2].sort());

      // Same single pooled connection, outside any transaction: SET LOCAL must be gone.
      const after = await handle.pool.query(
        `select current_setting('app.tenant_id', true) as t, (select count(*)::int from flows) as n`,
      );
      expect(after.rows[0].t ?? '').toBe('');
      expect(after.rows[0].n).toBe(0);
    } finally {
      await handle.close();
    }
  });

  it('rejects malformed tenant or user ids before touching the database', async () => {
    const handle = createDatabase(roleUrl('web', inject('isolationDb')), { max: 1 });
    try {
      await expect(
        withTenant(handle.db, { tenantId: "x' or 1=1 --" }, async () => 1),
      ).rejects.toThrow(TenantContextError);
      await expect(
        withTenant(handle.db, { tenantId: ID.tenantA, userId: 'nope' }, async () => 1),
      ).rejects.toThrow(TenantContextError);
    } finally {
      await handle.close();
    }
  });

  it('rolls back the context when the callback throws', async () => {
    const handle = createDatabase(roleUrl('web', inject('isolationDb')), { max: 1 });
    try {
      await expect(
        withTenant(handle.db, A_OWNER, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const { rows } = await handle.pool.query(
        `select current_setting('app.tenant_id', true) as t`,
      );
      expect(rows[0].t ?? '').toBe('');
    } finally {
      await handle.close();
    }
  });
});
