import { expect, test } from '@playwright/test';
import { latestMailTo, subjectsTo } from './mailpit';
import {
  account,
  cleanupSignups,
  code,
  company,
  email,
  fullSignup,
  plan,
  PASSWORD,
  tenantOf,
  terms,
  view,
} from './signup-flow';
import { adminQuery, USERS } from './support';

/**
 * Self-service signup (PLAN-SIGNUP S2): SU1–SU6 at 1440 × 900 and MS1–MS6 at 390 × 844, through
 * the real path: e-mail code from Mailpit, CVR fixture, plan from plan_entitlements, mock QuickPay
 * window → signed callback → agentor-ingest → worker → active. Fictional data only.
 * PLAYWRIGHT_SHOTS=1 writes a screenshot per board to docs/screenshots/signup/.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(cleanupSignups);
test.afterAll(cleanupSignups);

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
  // One receipt for the first payment (Q20), also after SU6 and Overblik are opened again.
  await expect
    .poll(async () => (await subjectsTo(address)).filter((x) => x.startsWith('Kvittering')).length)
    .toBe(1);
  await page.reload();
  await page.goto('/');
  await page.waitForTimeout(1_500);
  expect((await subjectsTo(address)).filter((x) => x.startsWith('Kvittering'))).toHaveLength(1);
  expect((await latestMailTo(address)).text).toContain('Betalt i alt: 1.987,50 kr.');
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
  for (const path of ['/', '/integrations', '/connections', '/onboarding/webshop']) {
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

test('CVR on SU3: VAT form and spaces accepted, typos and foreign VAT refused, outage falls back to manual entry', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const v = view(page, false);
  const address = email('cvr');
  await account(page, v, address);
  await code(page, v, address);
  const field = v.getByLabel('CVR-nummer');
  // Eight digits that fail modulus 11.
  await field.fill('12345678');
  await field.press('Enter');
  await expect(v.getByText('Det CVR-nummer findes ikke. Tjek cifrene.')).toBeVisible();
  // Another country's VAT number.
  await field.fill('SE556677889901');
  await field.press('Enter');
  await expect(v.getByText('Kun danske CVR-numre.', { exact: false })).toBeVisible();
  // The register is down: signup goes on with manual entry.
  await field.fill('99999993');
  await field.press('Enter');
  await expect(
    v.getByText('CVR-opslaget svarer ikke lige nu. Udfyld navn og adresse selv.'),
  ).toBeVisible();
  await expect(v.getByLabel('Virksomhedens navn')).toBeVisible();
  // The VAT form with spaces is the same company, found and stored as 8 digits.
  await field.fill('DK 12 34 56 74');
  await field.press('Enter');
  await expect(v.getByText('Fundet')).toBeVisible();
  await expect(v.getByText('Nordlys Cykler ApS')).toBeVisible();
  await v.getByRole('button', { name: 'WooCommerce', exact: true }).click();
  await v.getByRole('button', { name: 'Fortsæt', exact: true }).click();
  await expect(page).toHaveURL(/\/signup\/plan$/);
  const [t] = await adminQuery<{ cvr: string }>(
    `select t.cvr from tenants t join memberships m on m.tenant_id = t.id
       join auth.users u on u.id = m.user_id where u.email = $1`,
    [address],
  );
  expect(t!.cvr).toBe('12345674');
});
