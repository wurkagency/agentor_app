import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Development: read the repo-root .env.local (one file for all apps). Production uses the
// process environment set by PM2 from the 0400 env file.
const rootEnv = resolve(process.cwd(), '../../.env.local');
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@agentor/ui', '@agentor/i18n', '@agentor/core'],
  experimental: { authInterrupts: true },
  agentRules: false,
  // Database driver and repositories run as plain Node modules on the server.
  serverExternalPackages: ['@agentor/db', '@agentor/jobs', 'bullmq', 'pg', '@node-rs/argon2'],
};

export default withNextIntl(config);
