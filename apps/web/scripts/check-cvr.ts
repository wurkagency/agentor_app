/**
 * Checks the Virkdata CVR key (PLAN-SIGNUP B2) without printing it:
 *   pnpm --filter @agentor/web cvr:check            → key test (does not count against the quota)
 *   pnpm --filter @agentor/web cvr:check 12345678   → also looks up one CVR number
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const key = process.env.VIRKDATA_API_KEY;
if (!key) throw new Error('VIRKDATA_API_KEY is not set');

const res = await fetch('https://virkdata.dk/api/?test_api', {
  headers: { Authorization: key, Accept: 'application/json' },
  signal: AbortSignal.timeout(8000),
});
const test = (await res.json()) as { access?: boolean; version?: string; error_code?: number };
console.log(`Key test: access=${String(test.access)} version=${test.version ?? '?'}`);
if (!test.access) process.exit(1);

const cvr = process.argv[2];
if (cvr) {
  const { VirkdataCvrProvider } = await import('../src/server/cvr');
  const company = await new VirkdataCvrProvider(key).lookup(cvr);
  console.log(company ?? 'Not found');
}
