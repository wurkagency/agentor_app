import { expect, test, type Page } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { login } from './support';

// Agentor Platform sitemap v2 (README decision 24, PLAN-2026-10-21 M1): the top menu follows the
// role, Finans and Administration answer 404 to a Supporter, the old URLs redirect, and the views
// are filters in the URL.
test.describe.configure({ mode: 'serial' });

const ZERO = '00000000-0000-7000-8000-000000000000';

/** Every page, export and API under Finans and Administration. */
const SUPERADMIN_ONLY = [
  '/platform/finance',
  '/platform/finance?view=days',
  '/platform/finance/subscriptions',
  '/platform/finance/subscriptions/export',
  '/platform/finance/support',
  '/platform/finance/support/export',
  `/platform/finance/support/${TENANTS.nordlys.id}`,
  '/platform/finance/invoicing',
  '/platform/finance/invoicing/export',
  '/platform/finance/invoices',
  `/platform/finance/customers/${TENANTS.nordlys.id}`,
  `/platform/finance/invoices/${TENANTS.nordlys.id}/${ZERO}`,
  `/platform/finance/invoices/${TENANTS.nordlys.id}/${ZERO}/pdf`,
  '/platform/admin',
  '/platform/admin/status',
  '/platform/admin/users',
  '/platform/admin/users/audit',
  '/platform/admin/product',
  '/platform/admin/reports',
  '/platform/admin/reports/revenue',
  '/platform/admin/reports/revenue/export.csv',
  '/platform/admin/reports/revenue/export.pdf',
  '/platform/admin/reports/legacy',
  '/platform/admin/reports/support',
  '/platform/admin/reports/support/export.csv',
  '/platform/admin/reports/support/export.pdf',
  '/platform/admin/reports/invoicing',
  '/platform/admin/reports/invoicing/export.csv',
  '/platform/admin/reports/invoicing/export.pdf',
];

async function topMenu(page: Page) {
  return page
    .getByRole('navigation', { name: 'Platform', exact: true })
    .getByRole('link')
    .allInnerTexts();
}

test('a Supporter sees Kunder and Support, and Finans/Administration answer 404', async ({
  page,
}) => {
  await login(page, 'anne');
  await page.goto('/platform/customers');
  expect(await topMenu(page)).toEqual(['Kunder', 'Support']);
  for (const path of SUPERADMIN_ONLY) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
  // The old Finans URLs redirect first and then answer 404 at the new address.
  const old = await page.request.get('/platform/finance/payments');
  expect(old.status()).toBe(404);
  expect(old.url()).toContain('/platform/finance/invoicing');
});

test('Superadmin sees all four menus with their sub-menus', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/customers');
  expect(await topMenu(page)).toEqual(['Kunder', 'Support', 'Finans', 'Administration']);
  const sub = (section: string) =>
    page.getByRole('navigation', { name: `Sekundær navigation · ${section}` }).getByRole('link');
  await expect(sub('Kunder')).toHaveText(['Kunder']);
  await page.goto('/platform/support/cases');
  await expect(sub('Support')).toHaveText(['Sager', 'Adgange', 'Fejl', 'Tidsforbrug']);
  await page.goto('/platform/finance');
  await expect(sub('Finans')).toHaveText(['Oversigt', 'Abonnementer', 'Support', 'Fakturering']);
  await page.goto('/platform/admin/status');
  await expect(sub('Administration')).toHaveText([
    'System Status',
    'Brugere',
    'Produkt',
    'Rapporter',
  ]);
  for (const path of SUPERADMIN_ONLY.filter((p) => !p.includes(ZERO))) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
  }
  // The profile button opens the profile dashboard (PR1).
  await page.getByRole('link', { name: 'Profil og indstillinger' }).click();
  await expect(page).toHaveURL(/\/platform\/profile$/);
});

const REDIRECTS: [string, string][] = [
  ['/platform/cases', '/platform/support/cases?view=board'],
  ['/platform/cases/list', '/platform/support/cases?view=list'],
  ['/platform/cases/archive?q=moms', '/platform/support/cases?view=archive&q=moms'],
  ['/platform/cases/archive/export', '/platform/support/cases/export'],
  [`/platform/cases/${ZERO}`, `/platform/support/cases/${ZERO}`],
  [`/platform/cases/${ZERO}/resolve`, `/platform/support/cases/${ZERO}/resolve`],
  ['/platform/customers/mine', '/platform/support/access?filter=mine'],
  ['/platform/customers/recent', '/platform/customers'],
  ['/platform/errors?period=7d', '/platform/support/errors?period=7d'],
  ['/platform/time?week=2026-10-19', '/platform/support/time?week=2026-10-19'],
  ['/platform/time/team', '/platform/support/time?scope=team'],
  ['/platform/time/customers', '/platform/support/time?scope=customer'],
  ['/platform/time/export', '/platform/support/time/export'],
  ['/platform/status', '/platform/admin/status'],
  ['/platform/users', '/platform/admin/users'],
  ['/platform/users/roles', '/platform/admin/users'],
  ['/platform/users/audit', '/platform/admin/users/audit'],
  ['/platform/settings', '/platform/admin/product'],
  ['/platform/finance/payments', '/platform/finance/invoicing'],
  ['/platform/finance/payments/export', '/platform/finance/invoicing/export'],
];

test('the old URLs redirect permanently to the new ones', async ({ page }) => {
  await login(page, 'kasper');
  for (const [from, to] of REDIRECTS) {
    const res = await page.request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(308);
    const location = new URL(res.headers().location!, 'http://x');
    const want = new URL(to, 'http://x');
    expect(location.pathname, from).toBe(want.pathname);
    expect(Object.fromEntries(location.searchParams), from).toEqual(
      Object.fromEntries(want.searchParams),
    );
  }
  // Finans › Rapporter moved to Administration, with the month as a from/to period.
  await page.goto('/platform/finance/reports?month=2026-09');
  await expect(page).toHaveURL(
    /\/platform\/admin\/reports\/revenue\?from=2026-09-01&to=2026-09-30$/,
  );
  const csv = await page.request.get('/platform/finance/reports/export?month=2026-09');
  expect(csv.url()).toContain('/platform/admin/reports/revenue/export.csv?from=2026-09-01');
  expect(csv.headers()['content-type']).toContain('text/csv');
});

test('Sager: Tavle, Liste and Arkiv are a filter in the URL', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/support/cases');
  const views = page.getByRole('navigation', { name: 'Visning af sager' });
  await expect(page.getByRole('heading', { name: 'Sager', exact: true })).toBeVisible();
  await expect(views.getByRole('link', { name: 'Tavle' })).toHaveAttribute('aria-current', 'true');
  await views.getByRole('link', { name: 'Liste' }).click();
  await expect(page).toHaveURL(/view=list/);
  await page.reload();
  await expect(views.getByRole('link', { name: 'Liste' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Viser Liste' })).toHaveCount(1);
  await views.getByRole('link', { name: /^Arkiv · \d+$/ }).click();
  await expect(page).toHaveURL(/view=archive/);
  await expect(page.getByRole('heading', { name: 'Arkiv', exact: true })).toBeVisible();
  // The board's filters live in the URL and survive a reload.
  await page.goto('/platform/support/cases?view=board&mine=1');
  await page.reload();
  await expect(page.getByRole('button', { name: /Mine sager/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Fejl: filter by from/to and reload', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/support/errors');
  await expect(page.getByRole('heading', { name: 'Fejl', exact: true })).toBeVisible();
  const chips = page.getByRole('navigation', { name: 'Periode' });
  await expect(chips.getByRole('link', { name: '24 timer' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  const from = page.getByLabel('Fra').filter({ visible: true });
  const to = page.getByLabel('til', { exact: true }).filter({ visible: true });
  // A chosen date applies at once (no button on the board).
  await from.fill('2026-10-01');
  await expect(page).toHaveURL(/from=2026-10-01&to=/);
  // The page loads again; wait until it is interactive before the next date.
  await page.waitForLoadState('networkidle');
  await to.fill('2026-10-15');
  await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-15/);
  const status = page.getByRole('status').filter({ hasText: 'Viser' }).first();
  const text = await status.innerText();
  expect(text).toContain('1. okt. 2026');
  await page.reload();
  await expect(from).toHaveValue('2026-10-01');
  await expect(to).toHaveValue('2026-10-15');
  await expect(status).toHaveText(text);
  // No chip is chosen while a from/to period is shown; from/to wins over ?period.
  await expect(chips.getByRole('link', { name: '24 timer' })).not.toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.goto('/platform/support/errors?period=30d&from=2026-10-01&to=2026-10-15');
  await expect(status).toHaveText(text);
  // An invalid period falls back to the chips and says why.
  await page.goto('/platform/support/errors?from=2026-10-15&to=2026-10-01');
  await expect(page.getByText('Fra skal være før til').filter({ visible: true })).toBeVisible();
});

test('Tidsforbrug: Min tid, Team and Pr. kunde are a filter', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/support/time');
  await expect(page.getByRole('heading', { name: 'Tidsforbrug', exact: true })).toBeVisible();
  const scope = page.getByRole('navigation', { name: 'Vis tid for' });
  await expect(scope.getByRole('link')).toHaveText(['Min tid', 'Team', 'Pr. kunde']);
  await scope.getByRole('link', { name: 'Team' }).click();
  await expect(page).toHaveURL(/scope=team/);
  await page.reload();
  await expect(scope.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'true');
  await scope.getByRole('link', { name: 'Pr. kunde' }).click();
  await expect(page).toHaveURL(/scope=customer/);
  await expect(scope.getByRole('link', { name: 'Pr. kunde' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // The old Mig/Hele teamet toggle is gone.
  await expect(page.getByRole('link', { name: 'Mig', exact: true })).toHaveCount(0);
});

test('Support › Adgange lists grants with Mine/Alle', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/support/access');
  await expect(page.getByRole('heading', { name: 'Adgange', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Aktive og ventende' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seneste udløbne' })).toBeVisible();
  const filter = page.getByRole('navigation', { name: 'Vis adgange' });
  await expect(filter.getByRole('link', { name: /^Alle · \d+$/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await filter.getByRole('link', { name: /^Mine · \d+$/ }).click();
  await expect(page).toHaveURL(/filter=mine/);
  // Only one's own grants have actions, and every row in "Mine" is Anne's.
  const rows = page.getByRole('table', { name: 'Aktive og ventende' }).getByRole('row');
  for (const row of (await rows.all()).slice(1)) await expect(row).toContainText('(dig)');
  await page.getByRole('button', { name: 'Anmod om adgang' }).click();
  await expect(page.getByRole('dialog', { name: 'Anmod om supportadgang' })).toBeVisible();
});
