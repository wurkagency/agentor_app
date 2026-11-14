import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = resolve(process.cwd(), '../../.env.local');
if (!process.env.CI && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

/**
 * e2e + screenshot comparison. Desktop design width is 1440 × 900 (designspecifikation §3).
 * Visual snapshots are OS-specific (font rasterisation), so they live per platform and the
 * "visual" project only runs where baselines exist (PLAYWRIGHT_VISUAL=1).
 */
export default defineConfig({
  testDir: './e2e',
  // E2E_SKIP_SEED=1 keeps the current local data (e.g. while another dev server uses it).
  ...(process.env.E2E_SKIP_SEED === '1' ? {} : { globalSetup: './e2e/global-setup.ts' }),
  fullyParallel: false,
  workers: 1,
  // TOTP codes can't be reused, so some logins wait for the next 30-second period.
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      grepInvert: /@visual|@mobile/,
    },
    // Mobile and PWA (README decision 20): the boards are 390 × 844; 360 and 430 are the edges.
    ...(
      [
        ['mobile-390', 390, 844],
        ['mobile-360', 360, 780],
        ['mobile-430', 430, 932],
      ] as const
    ).map(([name, width, height]) => ({
      name,
      use: {
        ...devices['Pixel 5'],
        viewport: { width, height },
        deviceScaleFactor: 2,
      },
      grep: /@mobile/,
    })),
    ...(process.env.PLAYWRIGHT_VISUAL === '1'
      ? [
          {
            name: 'visual',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
            grep: /@visual/,
          },
        ]
      : []),
  ],
  // The web app plus the two processes the billing flow passes through (mock QuickPay callback →
  // agentor-ingest → queue → agentor-worker), so e2e exercises the real path.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: process.env.CI ? 'pnpm start' : 'pnpm dev',
          url: `${baseURL}/dev/components`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { AGENTOR_DEV_PAGES: '1', PORT: String(port) },
        },
        {
          command: process.env.CI
            ? 'node ../ingest/dist/main.js'
            : 'pnpm --filter @agentor/ingest dev',
          url: 'http://127.0.0.1:3100/healthz',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: process.env.CI
            ? 'node ../worker/dist/main.js'
            : 'pnpm --filter @agentor/worker dev',
          // The worker has no port; Playwright waits for its "worker started" log line instead.
          wait: { stdout: /worker started/ },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
