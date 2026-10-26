import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TenantContext {
  /** From the authenticated session or a re-validated job. Never from URL or body (§9.1). */
  readonly tenantId: string;
  /** The acting user. Omitted for jobs, which act on behalf of the tenant. */
  readonly userId?: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantContextError extends Error {
  override readonly name = 'TenantContextError';
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (!isUuid(value)) throw new TenantContextError(`${field} must be a UUID`);
}

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(
  connectionString: string,
  options: { max?: number; applicationName?: string } = {},
): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'agentor',
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/**
 * Runs fn in a transaction whose first statement sets the tenant (and user) context with
 * set_config(..., is_local => true), which is SET LOCAL: the context ends with the
 * transaction, so a pooled connection never carries one tenant into another request.
 */
export async function withTenant<T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(ctx.tenantId, 'tenantId');
  if (ctx.userId !== undefined) assertUuid(ctx.userId, 'userId');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Transaction without tenant context: for global tables (plan catalogue) and the
 * pre-tenant steps of authentication. Tenant tables return no rows here.
 */
export async function withoutTenant<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
  userId?: string,
): Promise<T> {
  if (userId !== undefined) assertUuid(userId, 'userId');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
