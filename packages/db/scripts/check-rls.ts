import pg from 'pg';
import { checkRls } from '../src/check-rls.js';
import { loadLocalEnv, requireEnv } from './env.js';

loadLocalEnv();
const client = new pg.Client({
  connectionString: process.env.CHECK_RLS_URL ?? requireEnv('DATABASE_URL_OWNER'),
});
await client.connect();
try {
  const problems = await checkRls(client);
  if (problems.length > 0) {
    console.error(`RLS check failed with ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('RLS check passed.');
  }
} finally {
  await client.end();
}
