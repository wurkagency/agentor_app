import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FLOWS } from '../scripts/seed-data';
import globalSetup from './global-setup';
import { login } from './support';

/** M6 acceptance: Overblik (D1), Integrationer (D2), flow detail (D7/D8), Aktivitet (D10). */

test.describe.configure({ mode: 'serial' });

// Earlier specs reconnect e-conomic and change flows; start from the board state.
test.beforeAll(() => globalSetup());

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

const WEBSHOP = FLOWS.webshop.id;

test('Overblik shows what needs action (D1-Overblik-Problemer)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '2 flows kræver handling' })).toBeVisible();
  const needs = page
    .getByRole('region', { name: 'Kræver handling' })
    .or(page.locator('[aria-labelledby="needs-action"]'));
  await expect(needs).toContainText('e-conomic er afbrudt.');
  await expect(needs).toContainText('3 ordrer blev ikke bogført.');
  await expect(needs).toContainText('Konto 1010 findes ikke i Dinero.');
  await expect(needs).toContainText('2 kreditnotaer fejlede.');
  await expect(needs.getByRole('link', { name: 'Ret konto' })).toHaveAttribute(
    'href',
    new RegExp(`/integrations/${WEBSHOP}/editor\\?route=orders-dinero`),
  );
  await expect(page.getByRole('region', { name: 'Synkroniseret omsætning' })).toBeVisible();
  await expect(
    page.getByLabel('Seneste aktivitet').or(page.locator('[aria-labelledby="recent"]')),
  ).toContainText('3 fejl');
  await axe(page);
  // The period is part of the URL.
  await page.getByRole('radio', { name: '30 dage' }).click();
  await expect(page).toHaveURL(/period=30d/);
});

test('Integrationer: routes, statuses and modes per flow (D2)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/integrations');
  await expect(page.getByText('6 flows · 1 med fejl · 1 afbrudt · 1 pauset')).toBeVisible();
  const table = page.getByRole('table', { name: 'Flows' });
  // The flow with errors is expanded by default.
  await expect(table).toContainText('Ordrer → Dinero Fakturaer');
  await expect(table).toContainText('Fejl · 3 records');
  await expect(table).toContainText('Pauset af Jonas Krag');
  await expect(table).toContainText('Test · skriver intet');
  await expect(table.getByRole('row', { name: /Outlet → regnskab/ })).toContainText('Afbrudt');
  await expect(table.getByRole('row', { name: /B2B-ordrer/ })).toContainText(
    'Kladde · ikke publiceret',
  );
  await expect(table.getByRole('link', { name: 'Genautentificér' })).toHaveAttribute(
    'href',
    /\/connections\/.+reconnect=1/,
  );
  await axe(page);

  // Filters narrow the list.
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('menuitemradio', { name: 'Pauset' }).click();
  await expect(table.getByRole('link', { name: /^Lager retur$/ })).toBeVisible();
  await expect(table.getByRole('link', { name: /^Kreditnotaer$/ })).toHaveCount(0);
});

test('bulk pause and resume (D2-Valg)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/integrations');
  await page.getByRole('checkbox', { name: 'Vælg Kreditnotaer' }).click();
  await page.getByRole('checkbox', { name: 'Vælg Kunder til nyhedsbrev' }).click();
  const bar = page.getByRole('region', { name: 'Handlinger for valgte flows' });
  await expect(bar).toContainText('2 flows valgt');
  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('2 flows er sat på pause')).toBeVisible();
  await expect(page.getByRole('row', { name: /Kreditnotaer · 1 rute/ })).toContainText('Pauset');
  await page.getByRole('checkbox', { name: 'Vælg Kreditnotaer' }).click();
  await page.getByRole('checkbox', { name: 'Vælg Kunder til nyhedsbrev' }).click();
  await page
    .getByRole('region', { name: 'Handlinger for valgte flows' })
    .getByRole('button', { name: 'Genoptag' })
    .click();
  await expect(page.getByText('2 flows kører igen')).toBeVisible();
});

test('flow detail explains the failure and how to fix it (D7-Flow-Fejl, D8)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto(`/integrations/${WEBSHOP}`);
  await expect(page.getByRole('heading', { name: 'Webshop → regnskab og CRM' })).toBeVisible();
  await expect(page.getByText('publiceret v7 af Jonas Krag')).toBeVisible();
  await expect(page.getByRole('alert').first()).toContainText(
    '3 ordrer kunne ikke bogføres i Dinero.',
  );
  await axe(page);

  await page
    .getByRole('navigation', { name: 'Flow' })
    .getByRole('link', { name: 'Kørsler' })
    .click();
  await expect(
    page.getByRole('heading', { name: /^Ordre #10\d+ blev ikke bogført i Dinero$/ }),
  ).toBeVisible();
  await expect(page.getByText('Kontoen 1010 findes ikke længere i Dinero.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Åbn indstilling' })).toHaveAttribute(
    'href',
    /tab=mapping&field=accounts.euB2b/,
  );
  await expect(page.getByText('Vises i Developer-visning.')).toBeVisible();
  await axe(page);
  await page.getByRole('radio', { name: 'Developer' }).click();
  await expect(page.getByText('ACCOUNT_NOT_FOUND')).toBeVisible();

  // Retrying with the stale account fails again: the cause has to be fixed in the editor.
  await page.goto(`/integrations/${WEBSHOP}`);
  await page.getByRole('alert').first().getByRole('button', { name: 'Gentag 3' }).click();
  await expect(page.getByText('Agentor prøver de fejlede records igen')).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('alert').first()).toContainText('3 ordrer', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});

test('activity log, CSV export and reconciliation (D10)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/activity?outcome=failed');
  const log = page.getByRole('table', { name: 'Aktivitet' });
  await expect(log).toContainText('#10447');
  await expect(log).toContainText('Fejlet · konto 1010 findes ikke i dinero');
  await axe(page);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Eksportér CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^aktivitet-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.goto('/activity/reconciliation');
  await expect(page.getByRole('combobox', { name: 'Flow' })).toContainText(
    'Webshop → regnskab og CRM',
  );
  await expect(page.getByRole('table', { name: 'Afstemning pr. dag' })).toContainText('3 ordrer');
  await axe(page);
});

test('notifications and search (D2-Notifikationer, D1-Søg)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/');
  await page.getByRole('button', { name: /^Notifikationer/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifikationer' });
  await expect(panel).toContainText('e-conomic-forbindelsen er afbrudt');
  await expect(panel).toContainText('3 records fejlede i Webshop → regnskab og CRM');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('10447');
  await expect(page.getByRole('option', { name: /#10447 · Hans Weber GmbH/ })).toBeVisible();
  await page.getByRole('combobox').fill('Webshop');
  await expect(page.getByRole('option', { name: /Webshop → regnskab og CRM/ })).toBeVisible();
});

test('readers see flows but cannot change them', async ({ page }) => {
  await login(page, 'bo');
  await page.goto('/integrations');
  await expect(page.getByRole('table', { name: 'Flows' })).toContainText(
    'Webshop → regnskab og CRM',
  );
  await expect(page.getByRole('checkbox', { name: /^Vælg / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Nyt flow' })).toHaveCount(0);
  await page.goto(`/integrations/${WEBSHOP}`);
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Gentag/ })).toHaveCount(0);
});
