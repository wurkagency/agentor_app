/**
 * Tables without tenant RLS. Everything else in schema "public" must have ENABLE + FORCE
 * ROW LEVEL SECURITY and at least one policy; scripts/check-rls.ts fails the build otherwise.
 */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  plans: 'Plan catalogue. Read-only for runtime roles.',
  plan_entitlements: 'Plan limits as data. Read-only for runtime roles.',
};

/** RLS tables that are not keyed by tenant_id and therefore get dedicated isolation tests. */
export const NON_TENANT_RLS_TABLES: Readonly<Record<string, string>> = {
  tenants: 'Policy id = app.current_tenant_id(), plus own tenants before a tenant is chosen.',
};

/**
 * Identity schema (Better Auth, ADR 0004). Not tenant data and not RLS-protected; only
 * agentor_web may access it, which check-rls enforces.
 */
export const AUTH_SCHEMA = 'auth';

/** Tables agentor_web must never be able to read (produktspecifikation §9.2). */
export const WORKER_ONLY_READ_TABLES = ['connection_secrets', 'tenant_keys'] as const;

/** Append-only tables: no runtime role may UPDATE, DELETE or TRUNCATE. */
export const APPEND_ONLY_TABLES = ['audit_log'] as const;

export const RUNTIME_ROLES = [
  'agentor_web',
  'agentor_worker',
  'agentor_support',
  'agentor_readonly_ops',
] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];
