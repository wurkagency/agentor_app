import { expect, test } from '@playwright/test';
import { PLATFORM_TENANTS, TENANTS } from '../scripts/seed-data';
import { latestMailTo } from './mailpit';
import { login } from './support';

// Finans (M9, F1–F7): Superadmin only. Support is billed per case with each registration rounded
// up to 15 min, drafts are approved before the run, reminders and reports go out by e-mail.
test.describe.configure({ mode: 'serial' });

test('Supporters and customers never see Finans', async ({ browser, page }) => {
  await login(page, 'anne');
  await page.goto('/platform/customers');
  await expect(page.getByRole('link', { name: 'Finans' })).toHaveCount(0);
  await page.goto('/platform/finance');
  await expect(
    page.getByText('Du har ikke adgang til denne side').filter({ visible: true }),
  ).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await login(customer, 'jonas');
  await customer.goto('/platform/finance/subscriptions');
  await expect(customer.getByText('Du har ikke adgang til denne side')).toBeVisible();
  await expect(customer.getByText('Mdl. abonnementsomsætning')).toHaveCount(0);
  await customer.context().close();
});

test('the overview shows revenue and what needs action', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance');
  await expect(page.getByRole('region', { name: 'Mdl. abonnementsomsætning' })).toBeVisible();
  const action = page.getByRole('link', { name: /Mølle Sport ApS.*Kortbetaling afvist/ });
  await expect(action).toBeVisible();
  await page.getByRole('link', { name: 'Dage', exact: true }).click();
  await expect(page.getByText('Omsætning pr. dag').filter({ visible: true })).toBeVisible();
});

test('subscriptions filter and a discount', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance/subscriptions');
  await page.getByRole('link', { name: /^Betalingsproblemer · \d+$/ }).click();
  const table = page.getByRole('table');
  await expect(table.getByText(PLATFORM_TENANTS.molle.name)).toBeVisible();
  await expect(table.getByText(PLATFORM_TENANTS.osterbro.name)).toHaveCount(0);

  await page.getByRole('button', { name: 'Tilføj rabat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tilføj rabat' });
  await dialog.getByRole('combobox', { name: 'Kunde' }).click();
  await page.getByRole('option', { name: PLATFORM_TENANTS.osterbro.name }).click();
  await dialog.getByRole('textbox', { name: 'Rabat i %' }).fill('20');
  await dialog.getByRole('button', { name: 'Gem rabat' }).click();
  await expect(page.getByText('Rabatten er gemt').filter({ visible: true })).toBeVisible();
  await page.goto('/platform/finance/subscriptions');
  await expect(
    page.getByRole('row', { name: new RegExp(PLATFORM_TENANTS.osterbro.name) }),
  ).toContainText('20 % rabat');
});

test('support is drafted per case, rounded per registration, and approved', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance/support');
  await expect(page.getByRole('heading', { name: /^Supportafregning · / })).toBeVisible();
  await page.getByRole('button', { name: 'Forhåndsvis fakturaer' }).click();
  await expect(page.getByRole('heading', { name: /^Supportfaktura · / })).toBeVisible();

  await page.goto(`/platform/finance/support/${TENANTS.nordlys.id}?rounding=1`);
  await expect(
    page.getByRole('heading', { name: 'Supportfaktura · Nordlys Cykler ApS' }),
  ).toBeVisible();
  // #2291: 42 + 15 + 15 min. registered, each rounded up: 45 + 15 + 15 = 1 t 15 min.
  const line = page.getByRole('row', { name: /#2291/ });
  await expect(line).toContainText('1 t 12 min.');
  await expect(line).toContainText('1 t 15 min.');
  await expect(
    page
      .getByText('20 min. på kundens sager er markeret som ikke fakturerbar')
      .filter({ visible: true }),
  ).toBeVisible();
  // A line by hand (goodwill) and the time log, before approval.
  await page.getByRole('button', { name: 'Tilføj linje' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tilføj linje' });
  await dialog.getByLabel('Tekst').fill('Goodwill for ventetid');
  await dialog.getByLabel('Beløb ekskl. moms (kr.)').fill('-160');
  await dialog.getByRole('button', { name: 'Tilføj linje' }).click();
  await expect(page.getByRole('row', { name: /Goodwill for ventetid/ })).toContainText('-160,00');
  const timelog = page.getByRole('checkbox', { name: /Vedhæft tidslog/ });
  await expect(timelog).toBeChecked();
  await timelog.click();
  await expect(timelog).not.toBeChecked();
  await page.getByRole('button', { name: 'Godkend' }).click();
  await expect(page.getByText('Godkendt af Kasper Nyborg').filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Godkendt' })).toBeDisabled();
});

test('a reminder and a payment link go to the customer by e-mail', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance/payments');
  const hav = page.getByRole('row', { name: new RegExp(PLATFORM_TENANTS.hav.name) }).first();
  await hav.getByRole('button', { name: 'Send rykker' }).click();
  await expect(
    page.getByText('Sendt til faktura@hav-hudpleje.test').filter({ visible: true }),
  ).toBeVisible();
  const mail = await latestMailTo('faktura@hav-hudpleje.test');
  expect(mail.subject).toMatch(/^Påmindelse: faktura INV\/\d{4}\/\d{5,} /);
  await page.reload();
  await expect(
    page.getByRole('row', { name: new RegExp(PLATFORM_TENANTS.hav.name) }).first(),
  ).toContainText('Rykker 1 sendt');

  const molle = page.getByRole('row', { name: new RegExp(PLATFORM_TENANTS.molle.name) }).first();
  await molle.getByRole('button', { name: 'Send betalingslink' }).click();
  const link = await latestMailTo('regnskab@molle-sport.test');
  expect(link.text).toContain('/billing');
});

test('the monthly report exports and goes to the bookkeeper', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/finance/reports');
  await expect(page.getByRole('region', { name: 'Omsætning i alt' })).toBeVisible();
  const csv = await page.request.get('/platform/finance/reports/export');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Omsætning ekskl. moms');
  const pdf = await page.request.get('/platform/finance/reports/pdf');
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  await page.getByRole('button', { name: 'Send til bogholder' }).click();
  await expect(
    page.getByText('Sendt til bogholder@agentor.test').filter({ visible: true }),
  ).toBeVisible();
  const mail = await latestMailTo('bogholder@agentor.test');
  expect(mail.subject).toMatch(/^Agentor · månedsrapport /);
});

test('Superadmin edits a plan in Platformindstillinger', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/settings');
  await page.getByRole('button', { name: 'Redigér Startup' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan: Startup' });
  await dialog.getByLabel('Brugere').fill('3');
  await dialog.getByRole('button', { name: 'Gem plan' }).click();
  await expect(page.getByText('Startup er gemt').filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Startup/ })).toContainText('3');
  // Back to the seed's value.
  await page.getByRole('button', { name: 'Redigér Startup' }).click();
  await page.getByRole('dialog').getByLabel('Brugere').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Gem plan' }).click();
  await expect(page.getByText('Startup er gemt').filter({ visible: true })).toBeVisible();
});
