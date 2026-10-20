import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { latestMailTo } from './mailpit';
import { adminQuery, USERS } from './support';

/**
 * Self-service signup (PLAN-SIGNUP S2): SU1–SU6 at 1440 × 900 and MS1–MS6 at 390 × 844, through
 * the real path: e-mail code from Mailpit, CVR fixture, plan from plan_entitlements, mock QuickPay
 * window → signed callback → agentor-ingest → worker → active. Fictional data only.
 * PLAYWRIGHT_SHOTS=1 writes a screenshot per board to docs/screenshots/signup/.
 */

const PASSWORD = 'e2e-signup-password-2026';
const SHOTS = process.env.PLAYWRIGHT_SHOTS === '1';
const SHOT_DIR = resolve(process.cwd(), '../../docs/screenshots/signup');
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

let n = 0;
const email = (tag: string) => `e2e-${tag}-${Date.now()}-${++n}@nordlys-cykler.dk`;

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

async function shot(page: Page, board: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${board}.png`, fullPage: true });
}

/** The visible branch (desktop from 768 px, mobile below). */
const view = (page: Page, mobile: boolean): Locator =>
  page.locator(`[data-view="${mobile ? 'mobile' : 'desktop'}"]`);

async function codeFromMail(address: string) {
  const mail = await latestMailTo(address, 15_000);
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1];
  expect(code, 'code in the subject').toBeTruthy();
  return code!;
}

async function account(page: Page, v: Locator, address: string) {
  await page.goto('/signup');
  await expect(v.getByRole('heading', { level: 1, name: 'Kom i gang med Agentor' })).toBeVisible();
  await v.getByLabel('Dit navn').fill('Mette Holm');
  await v.getByLabel('Email').fill(address);
  await v.getByLabel('Adgangskode').fill(PASSWORD);
  await v.getByRole('button', { name: 'Opret konto' }).click();
  await expect(page).toHaveURL(/\/signup\/verify$/);
}

async function code(page: Page, v: Locator, address: string) {
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

async function company(page: Page, v: Locator, mobile: boolean) {
  await v.getByLabel('CVR-nummer').fill('12345678');
  await v.getByLabel('CVR-nummer').press('Enter');
  await expect(v.getByText('Fundet')).toBeVisible();
  await expect(v.getByText('Nordlys Cykler ApS')).toBeVisible();
  for (const s of ['WooCommerce', 'Dinero', 'HubSpot'])
    await v.getByRole('button', { name: s, exact: true }).click();
  await v.getByRole('radio', { name: mobile ? '100–1.000' : '100–1.000' }).click();
  if (!mobile)
    await expect(v.getByText('WooCommerce, Dinero og HubSpot passer sammen')).toBeVisible();
}

async function plan(page: Page, v: Locator, mobile: boolean) {
  await expect(page).toHaveURL(/\/signup\/plan$/);
  await expect(v.getByText('Anbefalet til jer')).toBeVisible();
  await expect(v.getByText('2 måneder gratis')).toBeVisible();
  const cont = v.getByRole('button', {
    name: mobile ? 'Fortsæt med Business' : 'Fortsæt med Business årligt',
  });
  await expect(cont).toBeVisible();
  return cont;
}

async function terms(v: Locator) {
  const pay = v.getByRole('button', { name: /^Betal 1\.987,50 kr\. og start$/ });
  await expect(pay).toBeDisabled();
  await v.getByLabel('Jeg accepterer').check();
  await expect(pay).toBeDisabled();
  await v.getByLabel('Jeg har læst').check();
  await expect(pay).toBeEnabled();
  return pay;
}

async function tenantOf(address: string) {
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

async function fullSignup(page: Page, mobile: boolean, prefix: 'SU' | 'MS') {
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

test.describe.configure({ mode: 'serial' });

/** Companies and accounts this spec creates, so other specs see only the seed (and reruns stay clean). */
async function cleanup() {
  await adminQuery(
    `delete from tenants t using memberships m, auth.users u
      where m.tenant_id = t.id and u.id = m.user_id and u.email like 'e2e-%@nordlys-cykler.dk'`,
  );
  await adminQuery(`delete from auth.users where email like 'e2e-%@nordlys-cykler.dk'`);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

test('e-mail signup: code, CVR, plan, QuickPay callback, active (SU1–SU6)', async ({ page }) => {
  test.setTimeout(120_000);
  const address = await fullSignup(page, false, 'SU');
  // Terms: two documents, versioned, in the audit log.
  const t = await tenantOf(address);
  const accepted = await adminQuery<{ document: string; version: string }>(
    'select document, version from terms_acceptances where tenant_id = $1 order by document',
    [t!.id],
  );
  expect(accepted.map((a) => a.document)).toEqual(['privacy_policy', 'subscription_terms']);
  const audit = await adminQuery<{ action: string }>(
    `select action from audit_log where tenant_id = $1 and action in ('terms.accepted', 'tenant.activated')`,
    [t!.id],
  );
  expect(audit.map((a) => a.action).sort()).toEqual(['tenant.activated', 'terms.accepted']);
  // Card data never reaches us: nothing that looks like a card number in the payment tables.
  const pans = await adminQuery<{ hits: number }>(
    `select count(*)::int as hits from (
       select row_to_json(s)::text as j from subscriptions s where tenant_id = $1
       union all select row_to_json(i)::text from invoices i where tenant_id = $1
       union all select row_to_json(a)::text from audit_log a where tenant_id = $1
       union all select row_to_json(r)::text from terms_acceptances r where tenant_id = $1
     ) x where j ~ '[0-9]{13,19}'`,
    [t!.id],
  );
  expect(pans[0]!.hits).toBe(0);
  // An active company is sent away from signup.
  await page.goto('/signup/plan');
  await expect(page).not.toHaveURL(/\/signup\/plan/);
});

test('Google signup skips the code (mock identity provider)', async ({ page }) => {
  test.setTimeout(90_000);
  const v = view(page, false);
  const address = email('google');
  await page.goto('/signup');
  await v.getByRole('button', { name: 'Fortsæt med Google' }).click();
  await expect(page).toHaveURL(/\/dev\/oauth\/authorize/);
  await page.getByLabel('E-mail').fill(address);
  await page.getByRole('button', { name: 'Fortsæt som testbruger' }).click();
  await expect(page).toHaveURL(/\/signup\/company$/);
  await company(page, v, false);
  await v.getByRole('button', { name: 'Fortsæt', exact: true }).click();
  await (await plan(page, v, false)).click();
  await (await terms(v)).click();
  await page.getByRole('button', { name: 'Godkend kort' }).click();
  await expect(page).toHaveURL(/\/signup\/welcome$/, { timeout: 30_000 });
  expect((await tenantOf(address))?.signup_state).toBe('active');
});

test('the browser return without a callback leaves the company inactive', async ({ page }) => {
  test.setTimeout(90_000);
  const v = view(page, false);
  const address = email('nocallback');
  await account(page, v, address);
  await code(page, v, address);
  await company(page, v, false);
  await v.getByRole('button', { name: 'Fortsæt', exact: true }).click();
  await (await plan(page, v, false)).click();
  await terms(v);
  // Straight to the return URL, as if QuickPay redirected but never called back.
  await page.goto('/signup/payment?return=1');
  await expect(v.getByText('Vi venter på bekræftelse fra QuickPay …')).toBeVisible();
  await page.waitForTimeout(5_000);
  expect((await tenantOf(address))?.signup_state).toBe('pending_payment');
  // No app route is reachable.
  // /onboarding/* is added to this list in S3, when the onboarding routes exist.
  for (const path of ['/', '/integrations', '/connections']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signup\/payment/);
  }
});

test('abandon at payment, then resume after logging in again', async ({ page }) => {
  test.setTimeout(90_000);
  const v = view(page, false);
  const address = email('resume');
  await account(page, v, address);
  await code(page, v, address);
  await company(page, v, false);
  await v.getByRole('button', { name: 'Fortsæt', exact: true }).click();
  await (await plan(page, v, false)).click();
  await expect(page).toHaveURL(/\/signup\/payment$/);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(address);
  await page.getByLabel('Adgangskode', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(page).toHaveURL(/\/signup\/payment$/);
  // Choices survived: back to the company step shows them.
  await page.goto('/signup/company');
  await expect(v.getByRole('button', { name: 'WooCommerce', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // A later step opened too early sends the visitor to the current one.
  await page.goto('/signup/welcome');
  await expect(page).toHaveURL(/\/signup\/payment$/);
});

test('an existing e-mail gets the same answer and no valid code', async ({ page }) => {
  const v = view(page, false);
  const existing = USERS.mette.email;
  await account(page, v, existing);
  await expect(v.getByRole('heading', { level: 1, name: 'Tjek din indbakke' })).toBeVisible();
  const mail = await latestMailTo(existing, 15_000);
  expect(mail.subject).toBe('Du har allerede en konto hos Agentor');
  expect(mail.text).not.toMatch(/\b\d{6}\b/);
  for (const [i, d] of [...'123456'].entries()) await v.getByLabel(`Ciffer ${i + 1} af 6`).fill(d);
  await expect(v.getByText('Koden er forkert eller udløbet')).toBeVisible();
  await expect(page).toHaveURL(/\/signup\/verify$/);
});

test('mobile signup MS1–MS6 @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await fullSignup(page, true, 'MS');
});

test('mobile signup screens: no sideways scroll, 44 px targets, step at the bottom @mobile', async ({
  page,
}) => {
  const v = view(page, true);
  await page.goto('/signup');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of ['Fortsæt med Google', 'Fortsæt med Microsoft', 'Opret konto']) {
    const box = await v.getByRole('button', { name }).boundingBox();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  const step = await v.getByRole('navigation', { name: 'Trin 1 af 4: Konto' }).boundingBox();
  const button = await v.getByRole('button', { name: 'Opret konto' }).boundingBox();
  expect(step!.y).toBeGreaterThan(button!.y);
  // 40 px above the first heading (layout review).
  const pad = await v
    .getByRole('heading', { level: 1 })
    .evaluate((h) => getComputedStyle(h).paddingTop);
  expect(pad).toBe('40px');
});
