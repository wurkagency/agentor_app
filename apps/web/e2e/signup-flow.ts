import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { latestMailTo } from './mailpit';
import { adminQuery } from './support';

/** Shared by signup.spec.ts and onboarding.spec.ts (PLAN-SIGNUP S2/S3). Fictional data only. */

export const PASSWORD = 'e2e-signup-password-2026';
export const SHOTS = process.env.PLAYWRIGHT_SHOTS === '1';
export const SHOT_DIR = resolve(process.cwd(), '../../docs/screenshots/signup');
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

let n = 0;
export const email = (tag: string) => `e2e-${tag}-${Date.now()}-${++n}@nordlys-cykler.dk`;

export async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

export async function shot(page: Page, board: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${board}.png`, fullPage: true });
}

/** The visible branch (desktop from 768 px, mobile below). */
export const view = (page: Page, mobile: boolean): Locator =>
  page.locator(`[data-view="${mobile ? 'mobile' : 'desktop'}"]`);

export async function codeFromMail(address: string) {
  const mail = await latestMailTo(address, 15_000);
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1];
  expect(code, 'code in the subject').toBeTruthy();
  return code!;
}

/**
 * A full run signs up from one IP far more often than any person (10 codes per 15 minutes): the
 * signup counters are cleared before each signup, as global-setup does once per run. Login and
 * TOTP limits are left alone.
 */
export async function clearSignupLimits() {
  const { Redis } = await import('ioredis');
  const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  try {
    const keys = await r.keys('agentor:rl:signup:*');
    if (keys.length) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

export async function account(page: Page, v: Locator, address: string) {
  await clearSignupLimits();
  await page.goto('/signup');
  await expect(v.getByRole('heading', { level: 1, name: 'Kom i gang med Agentor' })).toBeVisible();
  await v.getByLabel('Dit navn').fill('Mette Holm');
  await v.getByLabel('Email').fill(address);
  await v.getByLabel('Adgangskode').fill(PASSWORD);
  await v.getByRole('button', { name: 'Opret konto' }).click();
  await expect(page).toHaveURL(/\/signup\/verify$/);
}

export async function code(page: Page, v: Locator, address: string) {
  await expect(v.getByText(address)).toBeVisible();
  // Paste fills all six cells and submits.
  const c = await codeFromMail(address);
  await v.getByLabel('Ciffer 1 af 6').focus();
  await page.evaluate((text) => {
    const el = document.activeElement as HTMLInputElement;
    const data = new DataTransfer();
    data.setData('text', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, c);
  await expect(page).toHaveURL(/\/signup\/company$/);
}

export async function company(page: Page, v: Locator, mobile: boolean) {
  await v.getByLabel('CVR-nummer').fill('12345674');
  await v.getByLabel('CVR-nummer').press('Enter');
  await expect(v.getByText('Fundet')).toBeVisible();
  await expect(v.getByText('Nordlys Cykler ApS')).toBeVisible();
  for (const s of ['WooCommerce', 'Dinero', 'HubSpot'])
    await v.getByRole('button', { name: s, exact: true }).click();
  await v.getByRole('radio', { name: mobile ? '100–1.000' : '100–1.000' }).click();
  if (!mobile)
    await expect(v.getByText('WooCommerce, Dinero og HubSpot passer sammen')).toBeVisible();
}

export async function plan(page: Page, v: Locator, mobile: boolean) {
  await expect(page).toHaveURL(/\/signup\/plan$/);
  await expect(v.getByText('Anbefalet til jer')).toBeVisible();
  await expect(v.getByText('2 måneder gratis')).toBeVisible();
  const cont = v.getByRole('button', {
    name: mobile ? 'Fortsæt med Business' : 'Fortsæt med Business årligt',
  });
  await expect(cont).toBeVisible();
  return cont;
}

export async function terms(v: Locator) {
  const pay = v.getByRole('button', { name: /^Betal 1\.987,50 kr\. og start$/ });
  await expect(pay).toBeDisabled();
  await v.getByLabel('Jeg accepterer').check();
  await expect(pay).toBeDisabled();
  await v.getByLabel('Jeg har læst').check();
  await expect(pay).toBeEnabled();
  return pay;
}

export async function tenantOf(address: string) {
  const rows = await adminQuery<{
    id: string;
    signup_state: string;
    onboarding_step: string | null;
  }>(
    `select t.id, t.signup_state, t.onboarding_step from tenants t
       join memberships m on m.tenant_id = t.id join auth.users u on u.id = m.user_id
      where u.email = $1`,
    [address],
  );
  return rows[0];
}

export async function fullSignup(page: Page, mobile: boolean, prefix: 'SU' | 'MS') {
  const v = view(page, mobile);
  const address = email(mobile ? 'mobile' : 'desktop');
  await page.goto('/signup');
  await axe(page);
  await shot(page, `${prefix}1-Opret-konto`);
  await account(page, v, address);
  await axe(page);
  await shot(page, `${prefix}2-Bekraeft-mail`);
  await code(page, v, address);
  await company(page, v, mobile);
  await axe(page);
  await shot(page, `${prefix}3-Virksomhed`);
  await v.getByRole('button', { name: 'Fortsæt', exact: true }).click();
  const cont = await plan(page, v, mobile);
  await axe(page);
  await shot(page, `${prefix}4-Abonnement`);
  await cont.click();
  await expect(page).toHaveURL(/\/signup\/payment$/);
  await expect(v.getByText('Moms 25 %')).toBeVisible();
  await expect(v.getByText('I alt i dag')).toBeVisible();
  const pay = await terms(v);
  await axe(page);
  await shot(page, `${prefix}5-Betaling`);
  expect((await tenantOf(address))?.signup_state).toBe('pending_payment');
  await pay.click();
  await expect(page).toHaveURL(/\/checkout\/mock/);
  await page.getByRole('button', { name: 'Godkend kort' }).click();
  // The return only waits; the verified callback activates and the page moves on.
  await expect(page).toHaveURL(/\/signup\/welcome$/, { timeout: 30_000 });
  await expect(v.getByRole('heading', { level: 1, name: 'Velkommen, Mette' })).toBeVisible();
  await expect(v.getByText('1.987,50 kr.')).toBeVisible();
  await axe(page);
  await shot(page, `${prefix}6-Velkommen`);
  expect(await tenantOf(address)).toMatchObject({
    signup_state: 'active',
    onboarding_step: 'webshop',
  });
  return address;
}

/** Companies and accounts this spec creates, so other specs see only the seed (and reruns stay clean). */
export async function cleanupSignups() {
  await adminQuery(
    `delete from tenants t using memberships m, auth.users u
      where m.tenant_id = t.id and u.id = m.user_id and u.email like 'e2e-%@nordlys-cykler.dk'`,
  );
  await adminQuery(`delete from auth.users where email like 'e2e-%@nordlys-cykler.dk'`);
}
