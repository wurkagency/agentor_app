import { expect, test, type Locator, type Page } from '@playwright/test';
import { axe, cleanupSignups, fullSignup, PASSWORD, shot, tenantOf, view } from './signup-flow';
import { adminQuery, base32Decode, totp } from './support';

/**
 * Onboarding after payment (PLAN-SIGNUP S3): MFA (B9) → OB1 webshop → OB2 accounting → OB3
 * template → OB4 test run (nothing written) → OB5 live as drafts, on desktop and at 390 px; and
 * "Spring over" → Overblik reminder → back. Connections use the mock provider (B4, B11).
 * PLAYWRIGHT_SHOTS=1 writes OB1–OB5 / MO1–MO5 to docs/screenshots/signup/.
 */

test.describe.configure({ mode: 'serial' });
test.beforeAll(cleanupSignups);
// E2E_KEEP=1 keeps the companies for inspecting a failure.
if (!process.env.E2E_KEEP) test.afterAll(cleanupSignups);

/** B9: the owner sets up two-step verification between SU6 and OB1. */
async function mfa(page: Page) {
  await expect(page).toHaveURL(/\/login\/mfa\/setup/);
  await page.getByLabel('Bekræft med din adgangskode').fill(PASSWORD);
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  const secret = (await page.locator('.font-mono').first().innerText()).trim();
  await page
    .getByLabel('Skriv den 6-cifrede kode fra appen')
    .fill(await totp(base32Decode(secret)));
  await page.getByRole('button', { name: 'Slå til' }).click();
  await page.getByRole('button', { name: 'Jeg har gemt koderne' }).click();
  await expect(page).toHaveURL(/\/onboarding\/webshop/, { timeout: 20_000 });
}

/** The mock provider's consent screen (stand-in for WooCommerce's or Dinero's own). */
async function consent(page: Page) {
  await expect(page).toHaveURL(/\/connect\/[a-z]+\?state=/);
  await page.getByRole('link', { name: 'Giv adgang' }).click();
}

async function start(page: Page, v: Locator) {
  await v.getByRole('link', { name: 'Start opsætningen · ca. 10 min.' }).click();
  await mfa(page);
}

async function onboard(page: Page, mobile: boolean, prefix: 'OB' | 'MO', address: string) {
  const v = view(page, mobile);
  // OB1: WooCommerce was chosen on SU3; the shop address and the approval at WooCommerce.
  await expect(v.getByRole('heading', { level: 1, name: 'Forbind jeres webshop' })).toBeVisible();
  await axe(page);
  await shot(page, `${prefix}1-Webshop`);
  await v.getByLabel('Butikkens adresse').fill('https://nordlys-cykler.dk');
  await v.getByRole('button', { name: 'Forbind WooCommerce' }).click();
  await consent(page);
  // Back, tested by the worker, then on to OB2 by itself.
  await expect(page).toHaveURL(/\/onboarding\/accounting/, { timeout: 30_000 });
  await expect(v.getByText('WooCommerce er forbundet.')).toBeVisible();
  await axe(page);
  await shot(page, `${prefix}2-Regnskab`);
  await v.getByRole('button', { name: 'Log ind hos Dinero' }).click();
  await consent(page);
  await expect(page).toHaveURL(/\/onboarding\/template/, { timeout: 30_000 });
  // OB3: the recommended template, as drafts.
  await expect(v.getByText('Anbefalet', { exact: true })).toBeVisible();
  await expect(v.getByRole('radio', { name: /Som kladde/ })).toBeChecked();
  await axe(page);
  await shot(page, `${prefix}3-Skabelon`);
  await v
    .getByRole('button', { name: mobile ? 'Brug og testkør' : 'Brug skabelonen og testkør' })
    .click();
  // OB4: the 10 latest orders; the EU B2B sale needs an account, chosen in the row.
  await expect(page).toHaveURL(/\/onboarding\/test\?run=/);
  await expect(
    v.getByText('Intet er skrevet til Dinero endnu. Sådan ville det se ud.'),
  ).toBeVisible();
  const pick = v.getByRole('combobox', { name: 'Konto for EU-salg' });
  await expect(pick.first()).toBeVisible({ timeout: 30_000 });
  await axe(page);
  await shot(page, `${prefix}4-Testkoersel`);
  const t = await tenantOf(address);
  // Nothing is written anywhere during the test run.
  const written = await adminQuery<{ n: number }>(
    `select count(*)::int as n from entity_links where tenant_id = $1`,
    [t!.id],
  );
  expect(written[0]!.n).toBe(0);
  const outcomes = await adminQuery<{ outcome: string }>(
    `select distinct outcome from run_records where tenant_id = $1`,
    [t!.id],
  );
  expect(outcomes.map((o) => o.outcome).filter((o) => o === 'created' || o === 'updated')).toEqual(
    [],
  );
  await pick.first().click();
  await page.getByRole('option', { name: '1015 Salg EU' }).click();
  // One account for EU B2B sales covers every such order; the test runs again without them.
  await expect(pick).toHaveCount(0, { timeout: 30_000 });
  await v.getByRole('button', { name: 'Gå live som kladde' }).click();
  // OB5: live as drafts.
  await expect(page).toHaveURL(/\/onboarding\/done$/, { timeout: 20_000 });
  await expect(v.getByText('Live som kladde')).toBeVisible();
  await axe(page);
  await shot(page, `${prefix}5-Klar`);
  const flows = await adminQuery<{ mode: string }>(
    `select r ->> 'mode' as mode from flows f join flow_versions v on v.id = f.published_version_id,
       jsonb_array_elements(v.definition -> 'routes') r
      where f.tenant_id = $1 and r ->> 'entity' = 'order'`,
    [t!.id],
  );
  expect(flows.map((f) => f.mode)).toEqual(['draft']);
  expect((await tenantOf(address))?.onboarding_step).toBe('done');
  await v.getByRole('link', { name: 'Gå til overblik' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('onboarding OB1–OB5: webshop, accounting, template, test run, live as drafts', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const address = await fullSignup(page, false, 'SU');
  await start(page, view(page, false));
  await onboard(page, false, 'OB', address);
});

test('Spring over lands on Overblik with a reminder until onboarding is done', async ({ page }) => {
  test.setTimeout(180_000);
  const address = await fullSignup(page, false, 'SU');
  const v = view(page, false);
  await start(page, v);
  await page.getByRole('button', { name: 'Spring over og gå til overblik' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Opsætningen er ikke færdig')).toBeVisible();
  await page.getByRole('button', { name: 'Fortsæt opsætningen' }).click();
  await expect(page).toHaveURL(/\/onboarding\/webshop$/);
  expect((await tenantOf(address))?.signup_state).toBe('active');
});

test('mobile onboarding MO1–MO5 @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  const address = await fullSignup(page, true, 'MS');
  await start(page, view(page, true));
  await onboard(page, true, 'MO', address);
});
