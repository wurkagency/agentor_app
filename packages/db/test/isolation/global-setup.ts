import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/migrate.js';
import { adminUrl, roleUrl } from './env.js';
import { seedFixtures } from './fixtures.js';

declare module 'vitest' {
  export interface ProvidedContext {
    isolationDb: string;
    tenantTables: string[];
    sabotaged: string | null;
  }
}

/**
 * Creates a throwaway database, migrates it as agentor_owner and seeds two tenants.
 * ISOLATION_SABOTAGE=<table> disables RLS on that table afterwards: the canary run uses it to
 * prove the suite fails when isolation is broken.
 */
export default async function setup(project: TestProject) {
  const sabotage = process.env.ISOLATION_SABOTAGE?.trim() || null;
  const dbName = `agentor_isolation_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName} owner agentor_owner`);
  await admin.query(`revoke all on database ${dbName} from public`);
  await admin.query(
    `grant connect on database ${dbName} to agentor_web, agentor_worker, agentor_support, agentor_readonly_ops`,
  );

  await runMigrations(roleUrl('owner', dbName));

  const db = new pg.Client({ connectionString: adminUrl(dbName) });
  await db.connect();
  await seedFixtures(db);
  if (sabotage) {
    if (!/^[a-z_]+$/.test(sabotage)) throw new Error('ISOLATION_SABOTAGE must be a table name');
    await db.query(`alter table ${sabotage} no force row level security`);
    await db.query(`alter table ${sabotage} disable row level security`);
  }
  const { rows } = await db.query<{ table: string }>(`
    select c.relname as table from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`);
  await db.end();

  project.provide('isolationDb', dbName);
  project.provide(
    'tenantTables',
    rows.map((r) => r.table),
  );
  project.provide('sabotaged', sabotage);

  return async () => {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  };
}
