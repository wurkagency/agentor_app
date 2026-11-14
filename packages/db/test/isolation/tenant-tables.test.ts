import { describe, expect, inject, it } from 'vitest';
import { ID } from './fixtures.js';
import { admin, hasPrivilege, INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

/**
 * Generic isolation tests, generated for every table in schema public that has a tenant_id
 * column. A new tenant table is covered automatically; coverage.test.ts makes sure it is seeded.
 */
const tables = inject('tenantTables');

const A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const roles = [
  { role: 'web' as const, ctx: A },
  { role: 'worker' as const, ctx: { tenantId: ID.tenantA } },
];

describe.each(tables)('tenant table %s', (table) => {
  describe.each(roles)('as $role', ({ role, ctx }) => {
    it('reads only rows of its own tenant, and all of them', async ({ skip }) => {
      if (!(await hasPrivilege(role, table, 'SELECT'))) {
        const { error } = await run(role, ctx, `select 1 from ${table} limit 1`);
        expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
        return skip();
      }
      const truth = await admin(`select count(*)::int as n from ${table} where tenant_id = $1`, [
        ID.tenantA,
      ]);
      expect(truth.rows[0].n, 'fixture rows for tenant A').toBeGreaterThan(0);

      const { result, error } = await run(role, ctx, `select tenant_id from ${table}`);
      expect(error).toBeUndefined();
      const seen = new Set(result!.rows.map((r) => r.tenant_id));
      expect([...seen]).toEqual([ID.tenantA]);
      expect(result!.rowCount).toBe(truth.rows[0].n);
    });

    it('sees nothing without tenant context', async () => {
      const { result, error } = await run(role, null, `select tenant_id from ${table}`);
      if (error) expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      else expect(result!.rowCount).toBe(0);
    });

    it('cannot select tenant B rows by filtering for them', async () => {
      const { result, error } = await run(
        role,
        ctx,
        `select 1 from ${table} where tenant_id = $1`,
        [ID.tenantB],
      );
      if (error) expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      else expect(result!.rowCount).toBe(0);
    });

    it('cannot update tenant B rows', async () => {
      const { result, error } = await run(
        role,
        ctx,
        `update ${table} set tenant_id = tenant_id where tenant_id = $1`,
        [ID.tenantB],
      );
      if (error) expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      else expect(result!.rowCount).toBe(0);
    });

    it('cannot delete tenant B rows', async () => {
      const { result, error } = await run(role, ctx, `delete from ${table} where tenant_id = $1`, [
        ID.tenantB,
      ]);
      if (error) expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      else expect(result!.rowCount).toBe(0);
    });

    it('cannot move its own rows into tenant B', async () => {
      const { result, error } = await run(
        role,
        ctx,
        `update ${table} set tenant_id = $2 where tenant_id = $1`,
        [ID.tenantA, ID.tenantB],
      );
      const canUpdate =
        (await hasPrivilege(role, table, 'UPDATE')) && (await hasPrivilege(role, table, 'SELECT'));
      if (canUpdate) {
        // The role can see and update its rows, so the WITH CHECK policy must reject the move.
        expect(error?.code, error?.message).toBe(INSUFFICIENT_PRIVILEGE);
      } else if (error) {
        expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      } else {
        expect(result!.rowCount).toBe(0);
      }
    });

    it('cannot insert a row for tenant B', async () => {
      const sample = await admin(
        `select row_to_json(t) as row from ${table} t where tenant_id = $1 limit 1`,
        [ID.tenantA],
      );
      const row = { ...sample.rows[0].row, tenant_id: ID.tenantB, id: crypto.randomUUID() };
      const { error } = await run(
        role,
        ctx,
        `insert into ${table} select * from json_populate_record(null::${table}, $1::json)`,
        [JSON.stringify(row)],
      );
      expect(error?.code, error?.message).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});
