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

test('M4 subscription', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/billing');
  await shot(page, 'D13-Abonnement', true);
});

test('M5 connections', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/connections');
  await shot(page, 'D9-Forbindelser');
  await page.goto('/connections/new');
  await shot(page, 'D9-Katalog', true);
  await page.goto('/connections/0190b000-0000-7000-8000-000000000304');
  await shot(page, 'D9-Afbrudt');
  await page.goto('/connect/dinero');
  await shot(page, 'D9-Login-mock');
});

test('M6 overview, integrations, flow, activity', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'mette');
  await page.goto('/');
  await shot(page, 'D1-Overblik-Problemer', true);
  await page.goto('/integrations');
  await shot(page, 'D2-Integrationer', true);
  await page
    .getByRole('button', { name: 'Notifikationer' })
    .first()
    .click()
    .catch(() => undefined);
  await page
    .locator('[aria-label^="Notifikationer"]')
    .first()
    .click()
    .catch(() => undefined);
  await shot(page, 'D2-Notifikationer');
  await page.keyboard.press('Escape');
  await page.goto('/integrations/0190b000-0000-7000-8000-000000000201');
  await shot(page, 'D7-Flow-Fejl', true);
  await page.goto('/integrations/0190b000-0000-7000-8000-000000000201?tab=runs');
  await shot(page, 'D8-Koersler-Forretning', true);
  await page.goto('/integrations/0190b000-0000-7000-8000-000000000201?tab=runs&view=developer');
  await shot(page, 'D8-Koersler-Udvikler', true);
  await page.goto('/activity');
  await shot(page, 'D10-Aktivitet-Log', true);
  await page.goto('/activity/reconciliation');
  await shot(page, 'D10-Afstemning', true);
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('10447');
  await page.waitForTimeout(800);
  await shot(page, 'D1-Soeg');
});
