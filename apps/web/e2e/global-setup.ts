import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Fresh Nordlys sample data before every run, so tests can change it freely. */
export default function globalSetup() {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { cwd, stdio: 'inherit' });
}
