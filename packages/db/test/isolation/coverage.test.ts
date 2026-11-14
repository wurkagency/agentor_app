import { describe, expect, inject, it } from 'vitest';
import { GLOBAL_TABLES, NON_TENANT_RLS_TABLES } from '../../src/tables.js';
import { ID } from './fixtures.js';
import { admin } from './helpers.js';

/**
 * Meta-test: fails when a table is added without isolation coverage. Every table in schema
 * public must be global (read-only catalogue), have dedicated tests (tenants, users), or be a
 * tenant table with fixture rows in both tenants, so the generic suite actually exercises it.
 */
describe('isolation coverage', () => {
  it('covers every table in schema public', async () => {
    const { rows } = await admin(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    );
    const tenantTables = new Set(inject('tenantTables'));
    const uncovered = rows
      .map((r) => r.table as string)
      .filter(
        (t) => !(t in GLOBAL_TABLES) && !(t in NON_TENANT_RLS_TABLES) && !tenantTables.has(t),
      );
    expect(uncovered).toEqual([]);
  });

  it.each(inject('tenantTables'))('%s has fixture rows in both tenants', async (table) => {
    const { rows } = await admin(
      `select count(*) filter (where tenant_id = $1)::int as a,
              count(*) filter (where tenant_id = $2)::int as b
         from ${table}`,
      [ID.tenantA, ID.tenantB],
    );
    expect(rows[0].a, `${table}: add rows for tenant A in fixtures.ts`).toBeGreaterThan(0);
    expect(rows[0].b, `${table}: add rows for tenant B in fixtures.ts`).toBeGreaterThan(0);
  });
});
