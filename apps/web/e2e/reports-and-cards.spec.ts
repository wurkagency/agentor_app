import { expect, test, type Page } from '@playwright/test';
import { login } from './support';

// Corrections of 22 Oct 2026: Rapporter as three dropdowns (type, period, Eksport), the key
// figures as cards on the phone, Kunder showing every customer by default, and the profile
// eyebrow with the role only.

async function presets(page: Page) {
  await page.getByRole('button', { name: /^Periode: / }).click();
  const items = page.getByRole('menuitem');
  const names = await items.allInnerTexts();
  await page.keyboard.press('Escape');
  return names.map((n) => n.trim());
}

test('Rapporter: type, period and Eksport are dropdowns, and the period lives in the URL', async ({
  page,
}) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/reports/support');
  // Support & Tid opens on last month.
  await expect(page.getByRole('button', { name: 'Rapporttype: Support & Tid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Periode: Sidste måned' })).toBeVisible();
  expect(await presets(page)).toEqual([
    'Denne måned',
    'Sidste måned',
    'Sidste kvartal',
    'År til dato',
    'Vælg datointerval',
  ]);

  await page.getByRole('button', { name: /^Periode: / }).click();
  await page.getByRole('menuitem', { name: 'Sidste kvartal' }).click();
  await expect(page).toHaveURL(/\/support\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('button', { name: 'Periode: Sidste kvartal' })).toBeVisible();
  await expect(page.getByLabel('Fra').filter({ visible: true })).toHaveCount(0);

  // "Vælg datointerval" shows Fra/til; a picked range stays a picked range.
  await page.getByRole('button', { name: /^Periode: / }).click();
  await page.getByRole('menuitem', { name: 'Vælg datointerval' }).click();
  const from = page.getByLabel('Fra').filter({ visible: true });
  await expect(from).toBeVisible();
  // Til first: the quarter ends before 2 Oct, and Fra after Til is not a period.
  await page.getByLabel('til', { exact: true }).filter({ visible: true }).fill('2026-10-31');
  await expect(page).toHaveURL(/to=2026-10-31/);
  await page.waitForLoadState('networkidle');
  await from.fill('2026-10-02');
  await expect(page).toHaveURL(/from=2026-10-02&to=2026-10-31/);
  await expect(page.getByRole('button', { name: 'Periode: Vælg datointerval' })).toBeVisible();

  // Eksport holds PDF, CSV and the bookkeeper, with the period's month.
  await page.getByRole('button', { name: 'Eksport' }).click();
  await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'CSV' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Send oktober til bogholder' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The type keeps the period.
  await page.getByRole('button', { name: /^Rapporttype: / }).click();
  await page.getByRole('menuitem', { name: 'Fakturering' }).click();
  await expect(page).toHaveURL(/\/invoicing\?from=2026-10-02&to=/);

  // Omsætning is a monthly report: only the whole-month presets.
  await page.goto('/platform/admin/reports/revenue');
  expect(await presets(page)).toEqual(['Denne måned', 'Sidste måned']);
});

test('Profil: the eyebrow is the role only', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/profile');
  await expect(page.getByText('Super Administrator', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Agentor Platform$/).filter({ visible: true })).toHaveCount(0);
});

test.describe('@mobile key figures as cards and the report menus', () => {
  const cards = async (page: Page, region: string) => {
    const strip = page.getByRole('region', { name: region });
    await expect(strip).toBeVisible();
    expect(await strip.locator('section').count()).toBeGreaterThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  };

  test('Kunder, Sager, Finans and Rapporter show their figures; Kunder shows everyone', async ({
    page,
  }) => {
    await login(page, 'kasper');
    await page.goto('/platform/customers');
    await cards(page, 'Nøgletal for kunder');
    await expect(page.getByRole('link', { name: /^Alle \d+$/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await page.goto('/platform/support/cases');
    await cards(page, 'Nøgletal for sager');
    await page.goto('/platform/finance');
    await cards(page, 'Nøgletal for Finans');
    await page.goto('/platform/admin/reports/revenue');
    await cards(page, 'Nøgletal for måneden');
    // The same three dropdowns: type and period at the top, Eksport above the tab bar.
    await expect(page.getByRole('button', { name: 'Rapporttype: Omsætning' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Periode: / })).toBeVisible();
    await page.getByRole('button', { name: 'Eksport' }).click();
    await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeVisible();
  });
});
