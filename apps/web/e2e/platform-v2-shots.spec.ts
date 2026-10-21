import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TENANTS } from '../scripts/seed-data';
import { login } from './support';

/**
 * Screenshots of the 21 Oct 2026 boards (PLAN-2026-10-21) at 1440 × 900, each next to the board
 * itself, for the PR. Not an assertion run:
 * PLAYWRIGHT_SHOTS=1 pnpm exec playwright test e2e/platform-v2-shots.spec.ts --project=desktop
 * Output: docs/screenshots/v2/<board>.png (app) and <board>.board.png (the board).
 */
test.skip(!process.env.PLAYWRIGHT_SHOTS, 'screenshots only on request');

const OUT = resolve('../../docs/screenshots/v2');
const BOARDS = resolve('../../docs/design/runde-1/boards');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, board: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${board}.png`, fullPage });
  // The board, at the same size, from its file on disk.
  const b = await page.context().newPage();
  await b.setViewportSize(page.viewportSize()!);
  await b.goto(pathToFileURL(`${BOARDS}/${board}.dc.html`).href);
  await b.waitForTimeout(300);
  await b.screenshot({ path: `${OUT}/${board}.board.png`, fullPage });
  await b.close();
}

test('M1 Kunder and Support (Supporter)', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/customers');
  await shot(page, 'P1-Kunder');
  await page.getByRole('button', { name: /Agentor Platform/ }).click();
  await shot(page, 'P1-Kunder-Menu');
  await page.keyboard.press('Escape');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await shot(page, 'P2-Kunde');
  const request = page.getByRole('button', { name: 'Anmod om adgang' }).first();
  if (await request.isVisible()) {
    await request.click();
    await shot(page, 'P3-Adgang');
    await page.keyboard.press('Escape');
  }
  await page.goto('/platform/support/cases');
  await shot(page, 'S1-Sager-Tavle');
  await page.goto('/platform/support/cases?view=archive');
  await shot(page, 'S2-Sager-Arkiv');
  await page.goto('/platform/support/cases?view=list');
  await page.getByRole('link', { name: 'Fakturaer til EU-kunder fejler' }).click();
  await page.waitForURL(/\/platform\/support\/cases\/[^/?]+$/);
  await shot(page, 'S3-Sag');
  const caseUrl = page.url();
  const register = page.getByRole('button', { name: /Registrér tid|Tilføj tid/ }).first();
  if (await register.isVisible()) {
    await register.click();
    await shot(page, 'S4-Tid-Tilfoej');
    await page.keyboard.press('Escape');
  }
  await page.goto(`${caseUrl}/resolve`);
  await shot(page, 'S8-Sag-Loes');
  await page.goto('/platform/support/access');
  await shot(page, 'S9-Adgange');
  await page.goto('/platform/support/errors');
  await shot(page, 'S7-Fejl');
  await page.goto('/platform/support/time');
  await shot(page, 'S6-Min-Tid');
});

test('M1 Finans and Administration (Superadmin)', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance');
  await shot(page, 'F1-Finans-Oversigt');
  await page.goto('/platform/finance?view=days');
  await shot(page, 'F1-Finans-Oversigt-Dage');
  await page.goto('/platform/finance/subscriptions');
  await shot(page, 'F2-Abonnementer');
  await page.goto('/platform/finance/support');
  await shot(page, 'F3-Support-Afregning');
  await page.goto(`/platform/finance/customers/${TENANTS.nordlys.id}`);
  await shot(page, 'F4-Kunde-Oekonomi');
  await page.goto(`/platform/finance/support/${TENANTS.nordlys.id}`);
  await shot(page, 'F5-Supportfaktura');
  await page.goto('/platform/finance/invoicing');
  await shot(page, 'F6-Betalinger');
  await page.goto('/platform/admin/users');
  await shot(page, 'P6-Platformbrugere');
  await page.goto('/platform/admin/reports/revenue');
  await shot(page, 'F7-Rapporter');
});

test('M2 Administration (Superadmin)', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/status');
  await shot(page, 'A1-Systemstatus');
  await page.goto('/platform/admin/product');
  await shot(page, 'A2-Produkt');
  await page.goto('/platform/admin/reports/support');
  await shot(page, 'A3-Rapport-Support');
  await page.goto('/platform/admin/reports/invoicing');
  await shot(page, 'A4-Rapport-Fakturering');
  await page.goto('/platform/admin/reports/revenue');
  await shot(page, 'F7-Rapporter');
});

/** A phone board at 390 × 844 next to the board, plus the app alone at 360 × 780. */
async function phone(page: Page, path: string, board: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await shot(page, board, true);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${board}-360.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('M3 Profile, staff (PR1, MP29)', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/profile');
  await shot(page, 'PR1-Profil', true);
  await phone(page, '/platform/profile', 'MP29-Profil');
});

test('M3 Profile, customer (D15, MA36)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/profile');
  await shot(page, 'D15-Profil', true);
  await phone(page, '/profile', 'MA36-Profil');
});
