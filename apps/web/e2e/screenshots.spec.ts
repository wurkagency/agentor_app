import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { login } from './support';

/**
 * Screenshots at 1440 × 900 for the PRs, next to the matching board. Not an assertion run:
 * PLAYWRIGHT_SHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts
 * Output: docs/screenshots/<board>.png
 */
test.skip(!process.env.PLAYWRIGHT_SHOTS, 'screenshots only on request');

const OUT = '../../docs/screenshots';
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

test('M2 login and MFA', async ({ page }) => {
  await page.goto('/login');
  await shot(page, 'D14-Login');
});

test('M2 shell and M3 settings', async ({ page }) => {
  await login(page, 'mette');
  await shot(page, 'App-skal-B');
  await page.getByRole('button', { name: /Konto og virksomhed/ }).click();
  await shot(page, 'App-skal-B-profilmenu');
  await page.keyboard.press('Escape');
  await page.goto('/settings/team');
  await shot(page, 'D11-Team');
  await page.getByRole('button', { name: 'Invitér' }).click();
  await shot(page, 'D11-Inviter');
  await page.keyboard.press('Escape');
  await page.goto('/settings/notifications');
  await shot(page, 'D12-Notifikationer');
  await page.goto('/settings/security');
  await shot(page, 'D12-Sikkerhed');
  await page.goto('/settings/audit-log');
  await shot(page, 'D12-Auditlog');
  await page.goto('/settings/company');
  await shot(page, 'App-skal-B-Indstillinger');
});
