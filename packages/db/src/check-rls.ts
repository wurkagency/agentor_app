import type pg from 'pg';
import {
  APPEND_ONLY_TABLES,
  GLOBAL_TABLES,
  NON_TENANT_RLS_TABLES,
  RUNTIME_ROLES,
  WORKER_ONLY_READ_TABLES,
} from './tables.js';

interface TableRow {
  table: string;
  rls: boolean;
  force: boolean;
  policies: number;
  hasTenantId: boolean;
}

/**
 * Structural security checks against a migrated database. Returns a list of problems;
 * an empty list means the database satisfies produktspecifikation §9.1 and §10.3.
 */
export async function checkRls(client: pg.ClientBase): Promise<string[]> {
  const problems: string[] = [];
  const hasPrivilege = async (role: string, table: string, privilege: string) =>
    (
      await client.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [
        role,
        `public.${table}`,
        privilege,
      ])
    ).rows[0]?.ok === true;

  const { rows: tables } = await client.query<TableRow>(`
    select c.relname as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
           exists (
             select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnotnull
                and not a.attisdropped and a.atttypid = 'uuid'::regtype
           ) as "hasTenantId"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`);

  if (tables.length === 0) problems.push('no tables in schema public (are migrations applied?)');

  for (const t of tables) {
    if (t.table in GLOBAL_TABLES) {
      for (const role of RUNTIME_ROLES) {
        for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          if (await hasPrivilege(role, t.table, p)) {
            problems.push(`${role} has ${p} on global table ${t.table}`);
          }
        }
      }
      continue;
    }
    if (!t.rls) problems.push(`${t.table}: row level security is not enabled`);
    if (!t.force) problems.push(`${t.table}: row level security is not forced`);
    if (t.policies === 0) problems.push(`${t.table}: has no policies`);
    if (!t.hasTenantId && !(t.table in NON_TENANT_RLS_TABLES)) {
      problems.push(`${t.table}: missing "tenant_id uuid not null" (or list it in src/tables.ts)`);
    }
    for (const role of ['agentor_support', 'agentor_readonly_ops']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        if (await hasPrivilege(role, t.table, p)) {
          problems.push(`${role} has ${p} on tenant table ${t.table}`);
        }
      }
    }
  }

  // Runtime roles are never superuser, never BYPASSRLS and own nothing.
  const { rows: roles } = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>('select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1)', [
    RUNTIME_ROLES,
  ]);
  for (const role of RUNTIME_ROLES) {
    const r = roles.find((x) => x.rolname === role);
    if (!r) {
      problems.push(`role ${role} does not exist`);
      continue;
    }
    if (r.rolsuper) problems.push(`${role} is a superuser`);
    if (r.rolbypassrls) problems.push(`${role} has BYPASSRLS`);
  }
  const { rows: owned } = await client.query<{ owner: string; object: string }>(
    `select pg_get_userbyid(c.relowner) as owner, n.nspname || '.' || c.relname as object
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where pg_get_userbyid(c.relowner) = any($1)
     union all
     select pg_get_userbyid(p.proowner), n.nspname || '.' || p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where pg_get_userbyid(p.proowner) = any($1)
     union all
     select pg_get_userbyid(n.nspowner), n.nspname
       from pg_namespace n
      where pg_get_userbyid(n.nspowner) = any($1)`,
    [RUNTIME_ROLES],
  );
  for (const o of owned) problems.push(`${o.owner} owns ${o.object}`);

  const tableNames = new Set(tables.map((t) => t.table));
  for (const table of WORKER_ONLY_READ_TABLES) {
    if (!tableNames.has(table)) {
      problems.push(`expected table ${table} is missing`);
      continue;
    }
    if (await hasPrivilege('agentor_web', table, 'SELECT')) {
      problems.push(`agentor_web can SELECT ${table}`);
    }
  }
  for (const table of APPEND_ONLY_TABLES) {
    for (const role of RUNTIME_ROLES) {
      for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) {
        if (await hasPrivilege(role, table, p)) {
          problems.push(`${role} has ${p} on append-only table ${table}`);
        }
      }
    }
  }
  return problems;
}
