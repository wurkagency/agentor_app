import { loadLocalEnv, requireEnv } from '../../scripts/env.js';

loadLocalEnv();

export type Role = 'owner' | 'web' | 'worker' | 'support' | 'ops';

const ROLE_ENV: Record<Role, string> = {
  owner: 'DATABASE_URL_OWNER',
  web: 'DATABASE_URL_WEB',
  worker: 'DATABASE_URL_WORKER',
  support: 'DATABASE_URL_SUPPORT',
  ops: 'DATABASE_URL_OPS',
};

/** Connection string for a role, pointed at the given database. */
export function roleUrl(role: Role, database: string): string {
  const url = new URL(requireEnv(ROLE_ENV[role]));
  url.pathname = `/${database}`;
  return url.toString();
}

export function adminUrl(database = 'postgres'): string {
  const url = new URL(requireEnv('DATABASE_ADMIN_URL'));
  url.pathname = `/${database}`;
  return url.toString();
}
