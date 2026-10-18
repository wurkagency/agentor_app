import { createOTP } from '@better-auth/utils/otp';
import { expect, type Page } from '@playwright/test';
import { SEED_PASSWORD, SEED_TOTP_SECRET, USERS } from '../scripts/seed-data';

export { SEED_PASSWORD, USERS };

export async function totp(secret = SEED_TOTP_SECRET): Promise<string> {
  return createOTP(secret, { digits: 6, period: 30 }).totp();
}

export async function fillPassword(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Adgangskode', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
}

/** Full sign-in. Users with MFA go through /login/mfa with a TOTP code. */
export async function login(page: Page, user: keyof typeof USERS) {
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
