import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import globalSetup from './global-setup';
import { base32Decode, fillPassword, fullLogin, login, totp, USERS } from './support';

/** M2 acceptance: authentication, MFA, roles, tenant switching and security headers. */

test('signed-out visitors are sent to /login', async ({ page }) => {
  await page.goto('/integrations');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Log ind' })).toBeVisible();
});

test('login page matches D14-Login and has no WCAG violations', async ({ page }) => {
  await page.goto('/login');
  await expect(
    page.getByText('Velkommen tilbage. Dine flows har kørt imens.').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Glemt adgangskode?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log ind med passkey' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Opret konto' })).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('a wrong password explains what to do, in Danish', async ({ page }) => {
  await fillPassword(page, USERS.bo.email, 'forkert-adgangskode-123');
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail eller adgangskode er forkert' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('owner signs in with password and TOTP and lands on Overblik', async ({ page }) => {
  await fullLogin(page, 'mette');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mette');
  const nav = page.getByRole('navigation', { name: 'Primær navigation' });
  await expect(nav.getByRole('link', { name: 'Overblik' })).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('button', { name: /Konto og virksomhed: Mette Holm, Nordlys Cykler ApS/ }),
  ).toBeVisible();
});

test('a wrong TOTP code is rejected with an explanation', async ({ page }) => {
  await fillPassword(page, USERS.jonas.email);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await page.getByLabel('Ciffer 1').filter({ visible: true }).fill('000000');
  await page.getByRole('button', { name: 'Bekræft' }).filter({ visible: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Koden passer ikke', visible: true }),
  ).toBeVisible();
});

test('a reader without MFA signs in but cannot open admin settings', async ({ page }) => {
  await login(page, 'bo');
  await page.goto('/settings/company');
  await expect(
    page.getByText('Du har ikke adgang til denne side').filter({ visible: true }),
  ).toBeVisible();
  await page.goto('/billing');
  await expect(
    page.getByText('Du har ikke adgang til denne side').filter({ visible: true }),
  ).toBeVisible();
  // Readers still reach their own notification settings.
  await page.goto('/settings/notifications');
  await expect(page.getByRole('heading', { name: 'Notifikationer', level: 1 })).toBeVisible();
});

test('profile menu switches language and company (keyboard)', async ({ page }) => {
  await login(page, 'mette');
  const openSub = async (account: RegExp, item: RegExp) => {
    await page.getByRole('button', { name: account }).click();
    await page.getByRole('menuitem', { name: item }).focus();
    await page.keyboard.press('ArrowRight');
  };
  const choose = async (name: string) => {
    const option = page.getByRole('menuitemradio', { name });
    await option.focus();
    await page.keyboard.press('Enter');
  };

  await openSub(/Konto og virksomhed/, /Sprog/);
  await choose('English');
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Overview' }),
  ).toBeVisible();

  await openSub(/Account and company/, /Language/);
  await choose('Dansk');
  await expect(
    page
      .getByRole('navigation', { name: 'Primær navigation' })
      .getByRole('link', { name: 'Overblik' }),
  ).toBeVisible();

  await openSub(/Konto og virksomhed/, /Skift virksomhed/);
  await choose('Nordlys Outlet ApS');
  await expect(
    page.getByRole('button', { name: /Konto og virksomhed: Mette Holm, Nordlys Outlet ApS/ }),
  ).toBeVisible();

  // Switch back: later tests reuse this session.
  await openSub(/Konto og virksomhed/, /Skift virksomhed/);
  await choose('Nordlys Cykler ApS');
  await expect(
    page.getByRole('button', { name: /Konto og virksomhed: Mette Holm, Nordlys Cykler ApS/ }),
  ).toBeVisible();
});

test('an admin without MFA must enrol before using the app', async ({ page }) => {
  // Remove Jonas' second factor directly (the seed restores it on the next run).
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL_WEB });
  await db.connect();
  await db.query(`delete from auth.two_factors where user_id = $1`, [USERS.jonas.id]);
  await db.query(`update auth.users set two_factor_enabled = false where id = $1`, [
    USERS.jonas.id,
  ]);
  await db.end();

  await fillPassword(page, USERS.jonas.email);
  await expect(page).toHaveURL(/\/login\/mfa\/setup$/);
  await page.getByLabel('Bekræft med din adgangskode').fill('Nordlys-demo-2026!');
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  const secret = await page.locator('.font-mono').first().innerText();
  await page
    .getByLabel('Skriv den 6-cifrede kode fra appen')
    .fill(await totp(base32Decode(secret.trim())));
  await page.getByRole('button', { name: 'Slå til' }).click();
  await expect(page.getByText('Gem dine reservekoder').filter({ visible: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Gem dine reservekoder' }).getByRole('listitem'),
  ).toHaveCount(8);
  await page.getByRole('button', { name: 'Jeg har gemt koderne' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jonas');

  // Jonas now has a new TOTP secret; restore the sample data for the tests that follow.
  globalSetup();
});

test('pages carry a nonce CSP and anti-framing headers', async ({ page }) => {
  const res = await page.goto('/login');
  const h = res!.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-powered-by']).toBeUndefined();
});

test('session cookie is HttpOnly and SameSite=Lax', async ({ page, context }) => {
  await login(page, 'bo');
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name.includes('session_token'));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
});

test('log out returns to the login page and ends the session', async ({ page }) => {
  await login(page, 'bo');
  await page.getByRole('button', { name: /Konto og virksomhed/ }).click();
  await page.getByRole('menuitem', { name: 'Log ud' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
