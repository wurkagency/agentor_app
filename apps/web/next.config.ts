import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Development: read the repo-root .env.local (one file for all apps). Production uses the
// process environment set by PM2 from the 0400 env file.
const rootEnv = resolve(process.cwd(), '../../.env.local');
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Old Platform URLs → sitemap v2. Kept for one release (PLAN-2026-10-21 §3.2). */
export const PLATFORM_REDIRECTS: [string, string][] = [
  ['/platform/cases', '/platform/support/cases?view=board'],
  ['/platform/cases/list', '/platform/support/cases?view=list'],
  ['/platform/cases/archive', '/platform/support/cases?view=archive'],
  ['/platform/cases/archive/export', '/platform/support/cases/export'],
  ['/platform/cases/:id', '/platform/support/cases/:id'],
  ['/platform/cases/:id/resolve', '/platform/support/cases/:id/resolve'],
  ['/platform/customers/mine', '/platform/support/access?filter=mine'],
  ['/platform/customers/recent', '/platform/customers'],
  ['/platform/errors', '/platform/support/errors'],
  ['/platform/time', '/platform/support/time'],
  ['/platform/time/team', '/platform/support/time?scope=team'],
  ['/platform/time/customers', '/platform/support/time?scope=customer'],
  ['/platform/time/export', '/platform/support/time/export'],
  ['/platform/status', '/platform/admin/status'],
  ['/platform/users', '/platform/admin/users'],
  ['/platform/users/roles', '/platform/admin/users'],
  ['/platform/users/audit', '/platform/admin/users/audit'],
  ['/platform/settings', '/platform/admin/product'],
  ['/platform/finance/payments', '/platform/finance/invoicing'],
  ['/platform/finance/payments/export', '/platform/finance/invoicing/export'],
  ['/platform/finance/reports', '/platform/admin/reports/legacy'],
  ['/platform/finance/reports/export', '/platform/admin/reports/legacy?format=csv'],
  ['/platform/finance/reports/pdf', '/platform/admin/reports/legacy?format=pdf'],
  // Min profil is now the profile dashboard (D15, README decision 25).
  ['/settings/profile', '/profile'],
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@agentor/ui', '@agentor/i18n', '@agentor/core'],
  // No upgrade menu during next build: it waits for a key and stalled agentor-deploy. Next.js is
  // upgraded in package.json and the lockfile.
  experimental: { authInterrupts: true, agentUpgrade: false },
  agentRules: false,
  // Server function arguments (passwords, codes) must never reach a log, not even in development.
  logging: { serverFunctions: false },
  // Keeps board screenshots clean.
  devIndicators: false,
  // Database driver and repositories run as plain Node modules on the server.
  serverExternalPackages: [
    '@agentor/db',
    '@agentor/email',
    '@agentor/jobs',
    '@agentor/pdf',
    '@agentor/storage',
    'bullmq',
    'pg',
    '@node-rs/argon2',
    'sharp',
  ],
  // Platform sitemap v2 (README decision 24): the old URLs answer 308 for one release. The query
  // string is passed on. Finans/Administration still answer 404 for a Supporter at the new URL.
  redirects: async () => [
    ...PLATFORM_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    })),
  ],
};

export default withNextIntl(config);
