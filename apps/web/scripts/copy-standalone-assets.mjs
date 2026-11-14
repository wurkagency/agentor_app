// `output: 'standalone'` leaves static assets out of the server bundle; copy them next to
// server.js so `pnpm start` (CI) and PM2 (production) serve the same thing.
import { cpSync, existsSync } from 'node:fs';

const target = '.next/standalone/apps/web';
if (existsSync(target)) {
  cpSync('.next/static', `${target}/.next/static`, { recursive: true });
  if (existsSync('public')) cpSync('public', `${target}/public`, { recursive: true });
}
