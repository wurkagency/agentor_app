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

test('Supporter sees customers but not Platformbrugere', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/customers');
  await expect(page.getByRole('link', { name: 'Nordlys Cykler ApS' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platformbrugere' })).toHaveCount(0);
  await page.goto('/platform/users');
  await expect(page.getByText('Du har ikke adgang til denne side')).toBeVisible();
});

test('Superadmin manages platform users', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/users');
  await expect(page.getByRole('heading', { name: 'Platformbrugere og roller' })).toBeVisible();
  await expect(page.getByText('anne@agentor.test')).toBeVisible();
});

test('a customer never sees internal notes', async ({ browser, page }) => {
  await login(page, 'anne');
  await page.goto('/platform/cases/list');
  await page.getByRole('link', { name: EU_CASE }).click();
  await expect(page.getByRole('heading', { name: EU_CASE })).toBeVisible();

  const composer = page.getByRole('textbox', { name: 'Svar til kunden' });
  await composer.fill('E2E svar: vi kigger på momskoden nu.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Svaret er sendt')).toBeVisible();
  // The composer is busy until the page has refreshed with the reply.
  await expect(page.getByText('E2E svar: vi kigger på momskoden nu.')).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Intern note' }).click();
  const note = page.getByRole('textbox', { name: 'Intern note' });
  await note.fill('E2E intern note: kun for Agentor.');
  await page.getByRole('button', { name: 'Gem note' }).click();
  await expect(note).toHaveValue('');
  await expect(page.getByText('E2E intern note: kun for Agentor.')).toBeVisible();

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
  await page.goto('/platform/cases/list');
  await expect(page.getByRole('link', { name: 'E2E: lagertal opdateres ikke' })).toBeVisible();
});

test('support view logs time on the case and can end the access', async ({ page }) => {
  await login(page, 'anne');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Åbn kundens app' }).click();
  await expect(page.getByRole('region', { name: 'Supportvisning' })).toBeVisible();
  // Support is never tenant admin: settings stay closed.
  await page.goto('/settings/team');
  await expect(page.getByText('Du har ikke adgang til denne side')).toBeVisible();

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
  await expect(page.getByText('Venter på kundens godkendelse', { exact: false })).toBeVisible();

  const customer = await as(browser, 'jonas');
  await customer.goto('/settings/security');
  const request = customer.locator('div', { hasText: 'E2E: vi vil se lagerflowet' }).last();
  await request.getByRole('button', { name: 'Godkend' }).click();
  await expect(request.getByText(/^Aktiv til/)).toBeVisible();
  await customer.context().close();

  await page.reload();
  await expect(page.getByText('Du har supportadgang til', { exact: false })).toBeVisible();
});
