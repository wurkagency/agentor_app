import { expect, test, type Browser, type Page } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { login } from './support';

// Agentor Platform (M8): staff see customers without data, get time-limited access only with the
// customer's approval, and the customer never sees internal notes.
test.describe.configure({ mode: 'serial' });

const EU_CASE = 'Fakturaer til EU-kunder fejler';

async function as(browser: Browser, user: Parameters<typeof login>[1]): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, user);
  return page;
}

test('Supporter sees customers but not Administration › Brugere', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/customers');
  await expect(page.getByRole('link', { name: 'Nordlys Cykler ApS' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  const res = await page.goto('/platform/admin/users');
  expect(res?.status()).toBe(404);
});

test('Superadmin manages platform users', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/users');
  await expect(page.getByRole('heading', { name: 'Brugere', exact: true })).toBeVisible();
  await expect(page.getByText('anne@agentor.test').filter({ visible: true })).toBeVisible();
});

test('a customer never sees internal notes', async ({ browser, page }) => {
  await login(page, 'anne');
  await page.goto('/platform/support/cases?view=list');
  await page.getByRole('link', { name: EU_CASE }).click();
  await expect(page.getByRole('heading', { name: EU_CASE })).toBeVisible();

  const composer = page.getByRole('textbox', { name: 'Svar til kunden' });
  await composer.fill('E2E svar: vi kigger på momskoden nu.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Svaret er sendt').filter({ visible: true })).toBeVisible();
  // The composer is busy until the page has refreshed with the reply.
  await expect(
    page.getByText('E2E svar: vi kigger på momskoden nu.').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Intern note' }).click();
  const note = page.getByRole('textbox', { name: 'Intern note' });
  await note.fill('E2E intern note: kun for Agentor.');
  await page.getByRole('button', { name: 'Gem note' }).click();
  await expect(note).toHaveValue('');
  await expect(
    page.getByText('E2E intern note: kun for Agentor.').filter({ visible: true }),
  ).toBeVisible();

  const customer = await as(browser, 'jonas');
  await customer.goto('/support');
  await customer.getByRole('link', { name: EU_CASE }).click();
  await expect(customer.getByText('E2E svar: vi kigger på momskoden nu.')).toBeVisible();
  await expect(customer.getByText('E2E intern note')).toHaveCount(0);
  await customer.context().close();
});

test('a customer opens a case and support sees it', async ({ browser, page }) => {
  const customer = await as(browser, 'jonas');
  await customer.goto('/support/new');
  await customer.getByLabel('Emne').fill('E2E: lagertal opdateres ikke');
  await customer
    .getByLabel('Hvad sker der?')
    .fill('Lagertal i webshoppen står stille siden i morges.');
  await customer.getByRole('button', { name: 'Send til support' }).click();
  await expect(
    customer.getByRole('heading', { name: 'E2E: lagertal opdateres ikke' }),
  ).toBeVisible();
  await customer.context().close();

  await login(page, 'anne');
  await page.goto('/platform/support/cases?view=list');
  await expect(page.getByRole('link', { name: 'E2E: lagertal opdateres ikke' })).toBeVisible();
});

test('support view logs time on the case and can end the access', async ({ page }) => {
  await login(page, 'anne');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Åbn kundens app' }).click();
  await expect(page.getByRole('region', { name: 'Supportvisning' })).toBeVisible();
  // Support is never tenant admin: settings stay closed.
  await page.goto('/settings/team');
  await expect(
    page.getByText('Du har ikke adgang til denne side').filter({ visible: true }),
  ).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Afslut supportvisning' }).click();
  const dialog = page.getByRole('dialog', { name: 'Afslut supportsession' });
  await expect(dialog.getByText(`#2291 ${EU_CASE}`)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Kort opsummering' }).fill('E2E: tjekkede momskoder');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: /^Gem .* på #2291$/ }).click();
  await expect(page).toHaveURL(/\/platform\//);

  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await expect(
    page.getByText('Du har ingen adgang til kundens data.', { exact: false }),
  ).toBeVisible();
});

test('access needs the customer’s approval', async ({ browser, page }) => {
  await login(page, 'anne');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Anmod om adgang' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Anmod om supportadgang' });
  await dialog
    .getByRole('textbox', { name: 'Begrundelse til kunden' })
    .fill('E2E: vi vil se lagerflowet');
  await dialog.getByRole('button', { name: 'Send anmodning' }).click();
  await expect(
    page.getByText('Venter på kundens godkendelse', { exact: false }).filter({ visible: true }),
  ).toBeVisible();

  const customer = await as(browser, 'jonas');
  await customer.goto('/settings/security');
  const request = customer.locator('div', { hasText: 'E2E: vi vil se lagerflowet' }).last();
  await request.getByRole('button', { name: 'Godkend' }).click();
  await expect(request.getByText(/^Aktiv til/)).toBeVisible();
  await customer.context().close();

  await page.reload();
  await expect(
    page.getByText('Du har supportadgang til', { exact: false }).filter({ visible: true }),
  ).toBeVisible();
});

test('Superadmin opens a customer app directly, without a request', async ({ browser, page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/customers');
  await page
    .getByRole('row', { name: /Nordlys Cykler ApS/ })
    .getByRole('button', { name: 'Åbn app' })
    .click();
  const bar = page.getByRole('region', { name: 'Supportvisning' });
  await expect(bar).toContainText('Super Administrator · direkte adgang');
  await page.getByRole('button', { name: 'Afslut supportvisning' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kassér tid' }).click();

  // Nothing to approve and nothing in Sikkerhed: it shows in the audit log only.
  const customer = await (await browser.newContext()).newPage();
  await login(customer, 'jonas');
  await customer.goto('/settings/security');
  await expect(customer.getByText('Kasper Nyborg bad om adgang')).toHaveCount(0);
  await customer.goto('/settings/audit-log');
  await expect(customer.getByText('Kasper Nyborg').first()).toBeVisible();
  await customer.context().close();
});

test('Superadmin creates a customer; the owner accepts, pays and the company is active', async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  const { adminQuery } = await import('./support');
  const { latestMailTo } = await import('./mailpit');
  const { axe, PASSWORD, terms } = await import('./signup-flow');
  const owner = `e2e-staffcreated-${Date.now()}@nordlys-cykler.dk`;
  const name = `E2E Kunde ${Date.now()} ApS`;
  await login(page, 'kasper');
  await page.goto('/platform/customers');
  await page.getByRole('button', { name: 'Opret kunde' }).click();
  const dialog = page.getByRole('dialog', { name: 'Opret kunde' });
  await dialog.getByLabel('CVR-nummer (valgfrit)').fill('12345678');
  await dialog.getByRole('button', { name: 'Slå op' }).click();
  await expect(dialog.getByText('Det CVR-nummer findes ikke. Tjek cifrene.')).toBeVisible();
  await dialog.getByLabel('CVR-nummer (valgfrit)').fill('DK 12 34 56 74');
  await dialog.getByRole('button', { name: 'Slå op' }).click();
  await expect(dialog.getByText('Fundet: Nordlys Cykler ApS')).toBeVisible();
  await axe(page);
  await page.screenshot({ path: test.info().outputPath('create-customer.png') });
  await dialog.getByLabel('Firmanavn').fill(name);
  await dialog.getByLabel('Ejerens e-mail').fill(owner);
  await dialog.getByRole('combobox', { name: 'Betaling' }).click();
  await page.getByRole('option', { name: 'Årlig' }).click();
  await dialog.getByRole('button', { name: 'Opret og send invitation' }).click();
  await expect(page).toHaveURL(/\/platform\/customers\/[0-9a-f-]{36}\?created=1$/);
  await expect(
    page.getByText('Kunden er oprettet, og ejeren har fået en mail').filter({ visible: true }),
  ).toBeVisible();
  const [t] = await adminQuery<{ id: string; signup_state: string }>(
    'select id, signup_state from tenants where name = $1',
    [name],
  );
  expect(t!.signup_state).toBe('pending_payment');

  // The owner, in their own browser: invitation → login → SU5 → card → active.
  const mail = await latestMailTo(owner, 20_000);
  const link = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(mail.text)![0];
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await p.goto(new URL(link).pathname);
    await expect(p.getByText(`${name} har inviteret dig som ejer.`)).toBeVisible();
    await p.getByLabel('Dit navn').fill('Ida Ejer');
    await p.getByLabel('Vælg adgangskode').fill(PASSWORD);
    await p.getByRole('button', { name: 'Opret konto og acceptér' }).click();
    await expect(p).toHaveURL(/\/signup\/payment$/, { timeout: 20_000 });
    const v = p.locator('[data-view="desktop"]');
    await (await terms(v)).click();
    await p.getByRole('button', { name: 'Godkend kort' }).click();
    await expect(p).toHaveURL(/\/signup\/welcome$/, { timeout: 30_000 });
    const [after] = await adminQuery<{ signup_state: string }>(
      'select signup_state from tenants where id = $1',
      [t!.id],
    );
    expect(after!.signup_state).toBe('active');
  } finally {
    await ctx.close();
    await adminQuery('delete from tenants where id = $1', [t!.id]);
    await adminQuery('delete from auth.users where email = $1', [owner]);
  }
});
