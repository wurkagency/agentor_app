import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { latestMailTo } from './mailpit';
import { base32Decode, login, totp } from './support';

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

test('M4 sign-up and onboarding', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `skaerm.${Date.now()}@e2e.agentor.test`;
  const password = 'Skaermbillede-kodeord-1';
  await page.goto('/signup');
  await shot(page, 'Signup');
  await page.getByLabel('Dit navn').fill('Ida Ejer');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Adgangskode').fill(password);
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Opret konto' }).click();
  const mail = await latestMailTo(email, 20_000);
  await page.goto(/https?:\/\/\S+verify-email\S+/.exec(mail.text)![0]);
  await page.getByLabel('CVR-nummer').fill('12345678');
  await page.getByRole('button', { name: 'Slå op' }).click();
  await page.getByRole('status').waitFor();
  await page.getByLabel('E-mail til fakturaer').fill('regnskab@nordlys-cykler.dk');
  await page.getByLabel('Telefon til SMS-alarmer').fill('+45 20 12 12 48');
  await page.getByLabel('Ordrer pr. måned, cirka').click();
  await page.getByRole('option', { name: '200–1.000' }).click();
  await shot(page, 'D14-Onboarding-1');
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  await page.getByLabel('Bekræft med din adgangskode').fill(password);
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  const secret = (await page.locator('.font-mono').first().innerText()).trim();
  await page
    .getByLabel('Skriv den 6-cifrede kode fra appen')
    .fill(await totp(base32Decode(secret)));
  await page.getByRole('button', { name: 'Slå til' }).click();
  await page.getByRole('button', { name: 'Jeg har gemt koderne' }).click();
  await page.waitForURL(/\/onboarding\/plan$/);
  await shot(page, 'D14-Onboarding-2');
  await page.getByRole('button', { name: 'Tilføj kort' }).click();
  await page.waitForURL(/\/checkout\/mock/);
  await shot(page, 'Checkout-mock');
  await page.getByRole('button', { name: 'Godkend kort' }).click();
  await page.getByText('Visa •••• 4242 er tilføjet').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  await page.waitForURL(/\/onboarding\/flow$/);
  await shot(page, 'D14-Onboarding-3');
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
