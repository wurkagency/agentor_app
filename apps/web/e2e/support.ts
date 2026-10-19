import { createOTP } from '@better-auth/utils/otp';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
      // Staff without a company of their own land in Agentor Platform.
      await expect(page).toHaveURL(/\/$|\/platform\//);
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
    // A full run signs in many times; the TOTP endpoint allows 5 tries a minute per IP, so a
    // rate-limited attempt waits for the window to pass and tries once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel('Ciffer 1').fill(await totp());
      await page.getByRole('button', { name: 'Bekræft' }).click();
      const limited = page.getByText('For mange forsøg på kort tid');
      const done = await Promise.race([
        page.waitForURL(/\/$/, { timeout: 10_000 }).then(() => true),
        limited.waitFor({ timeout: 10_000 }).then(() => false),
      ]).catch(() => false);
      if (done) break;
      if (attempt === 0) {
        test.info().setTimeout(test.info().timeout + 75_000);
        await page.waitForTimeout(61_000);
      }
    }
  }
  await expect(page).toHaveURL(/\/$/);
}

/** RFC 4648 base32 → string (the otpauth secret is the base32 of the raw secret). */
export function base32Decode(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of input.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
