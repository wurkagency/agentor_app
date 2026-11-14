import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Fresh Nordlys sample data before every run, so tests can change it freely. Rate-limit and
 * lockout counters are cleared too: a run signs up and signs in more often than any person.
 */
export default function globalSetup() {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { cwd, stdio: 'inherit' });
  execFileSync(
    process.execPath,
    [
      '-e',
      `const { Redis } = require('ioredis');
       const r = new Redis(process.env.REDIS_URL);
       (async () => {
         for (const p of ['agentor:rl:*', 'agentor:lockout:*']) {
           const keys = await r.keys(p);
           if (keys.length) await r.del(...keys);
         }
         r.disconnect();
       })();`,
    ],
    { cwd, stdio: 'inherit' },
  );
}
