import pg from 'pg';
import { afterAll, inject } from 'vitest';
import { adminUrl, roleUrl, type Role } from './env.js';

export interface Ctx {
  tenantId?: string;
  userId?: string;
}

const clients = new Map<string, pg.Client>();

async function client(role: Role | 'admin'): Promise<pg.Client> {
  const db = inject('isolationDb');
  const key = role;
  let c = clients.get(key);
  if (!c) {
    c = new pg.Client({ connectionString: role === 'admin' ? adminUrl(db) : roleUrl(role, db) });
    await c.connect();
    clients.set(key, c);
  }
  return c;
}

afterAll(async () => {
  await Promise.all([...clients.values()].map((c) => c.end()));
  clients.clear();
});

/**
 * Runs one statement as `role` inside a transaction with the given context, then rolls back,
 * so tests never change the seeded data. Returns the result or the Postgres error.
 */
export async function run(
  role: Role,
  ctx: Ctx | null,
  text: string,
  values: unknown[] = [],
): Promise<{ result?: pg.QueryResult; error?: pg.DatabaseError }> {
  const c = await client(role);
  await c.query('begin');
  try {
    if (ctx) {
      await c.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
        [ctx.tenantId ?? '', ctx.userId ?? ''],
      );
    }
    return { result: await c.query(text, values) };
  } catch (error) {
    if (error instanceof pg.DatabaseError) return { error };
    throw error;
  } finally {
    await c.query('rollback');
  }
}

/** Runs a statement as superuser (bypasses RLS) to read ground truth. */
export async function admin(text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  return (await client('admin')).query(text, values);
}

export async function hasPrivilege(role: Role, table: string, privilege: string): Promise<boolean> {
  const name = {
    owner: 'agentor_owner',
    web: 'agentor_web',
    worker: 'agentor_worker',
    support: 'agentor_support',
    ops: 'agentor_readonly_ops',
  }[role];
  const { rows } = await admin('select has_table_privilege($1, $2, $3) as ok', [
    name,
    `public.${table}`,
    privilege,
  ]);
  return rows[0]?.ok === true;
}

/** 42501 = insufficient_privilege: both "permission denied" and RLS WITH CHECK violations. */
export const INSUFFICIENT_PRIVILEGE = '42501';
