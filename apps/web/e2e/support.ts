import { createOTP } from '@better-auth/utils/otp';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { SEED_PASSWORD, SEED_TOTP_SECRET, USERS } from '../scripts/seed-data';

export { SEED_PASSWORD, USERS };

const used = new Map<string, string>();

/**
 * Current TOTP code. Better Auth rejects a code that was already used (replay protection), so
 * when the current period's code has been used, wait for the next period.
 */
export async function totp(secret = SEED_TOTP_SECRET): Promise<string> {
  let code = await createOTP(secret, { digits: 6, period: 30 }).totp();
  if (used.get(secret) === code) {
    const wait = 30_000 - (Date.now() % 30_000) + 500;
    await new Promise((r) => setTimeout(r, wait));
    code = await createOTP(secret, { digits: 6, period: 30 }).totp();
  }
  used.set(secret, code);
  return code;
}

export async function fillPassword(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Adgangskode', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
}

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>;
const sessions = new Map<string, Cookies>();

/**
 * Signs in as a seeded user. The session cookies are reused across tests (one worker), which
 * avoids waiting for fresh TOTP codes; a revoked session falls back to a full sign-in.
 */
export async function login(page: Page, user: keyof typeof USERS) {
  const cached = sessions.get(user);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto('/');
    if (!/\/login/.test(page.url())) {
      await expect(page).toHaveURL(/\/$/);
      return;
    }
    await page.context().clearCookies();
    sessions.delete(user);
  }
  await fullLogin(page, user);
  sessions.set(user, await page.context().cookies());
}

/** Full sign-in. Users with MFA go through /login/mfa with a TOTP code. */
export async function fullLogin(page: Page, user: keyof typeof USERS) {
  const u = USERS[user];
  await fillPassword(page, u.email);
  if (u.mfa) {
    await expect(page).toHaveURL(/\/login\/mfa$/);
    const code = await totp();
    await page.getByLabel('Ciffer 1').fill(code);
    await page.getByRole('button', { name: 'Bekræft' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}
