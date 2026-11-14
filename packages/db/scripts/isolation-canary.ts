/**
 * Canary for the isolation suite: disables RLS on a tenant table in a throwaway database and
 * runs the suite. The canary passes only if the suite FAILS, with tests both passing and
 * failing (so a setup crash can't count as success). Proves the suite would catch a real leak.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const table = process.argv[2] ?? 'flows';
const dir = mkdtempSync(join(tmpdir(), 'agentor-canary-'));
const report = join(dir, 'report.json');

const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const res = spawnSync(
  process.execPath,
  [vitestBin, 'run', '--project', 'isolation', '--reporter=json', `--outputFile=${report}`],
  { env: { ...process.env, ISOLATION_SABOTAGE: table }, stdio: ['ignore', 'ignore', 'inherit'] },
);

let failed = 0;
let passed = 0;
let failedTitles: string[] = [];
try {
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    numFailedTests: number;
    numPassedTests: number;
    testResults: { assertionResults: { status: string; fullName: string }[] }[];
  };
  failed = json.numFailedTests;
  passed = json.numPassedTests;
  failedTitles = json.testResults
    .flatMap((f) => f.assertionResults)
    .filter((a) => a.status === 'failed')
    .map((a) => a.fullName);
} catch {
  // no report: setup crashed
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `Canary: RLS disabled on "${table}". Suite exit code ${res.status}, ${failed} failed, ${passed} passed.`,
);
for (const t of failedTitles) console.log(`  ✗ ${t}`);

if (res.status !== 0 && failed > 0 && passed > 0) {
  console.log('Canary OK: the isolation suite detects the broken table.');
} else {
  console.error('Canary FAILED: the isolation suite did not detect disabled RLS.');
  process.exitCode = 1;
}
