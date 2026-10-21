import { expect, test, type Page } from '@playwright/test';
import { pdfTexts } from '../src/server/report-pdf';
import { adminQuery, login } from './support';

// Administration (README decision 24, PLAN-2026-10-21 M2): System Status with incidents, Produkt
// with price versions, and the reports with PDF/CSV that match the page.
test.describe.configure({ mode: 'serial' });

test('System Status: create an incident and plan maintenance, both audit-logged', async ({
  page,
}) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/status');
  await expect(page.getByRole('heading', { name: 'System Status', exact: true })).toBeVisible();
  // Figures that aren't measured say so; none are invented.
  await expect(page.getByText('Måles ikke endnu').filter({ visible: true }).first()).toBeVisible();

  const title = `E2E: Dinero svarer langsomt ${Date.now()}`;
  await page.getByRole('button', { name: 'Opret hændelse' }).click();
  const dialog = page.getByRole('dialog', { name: 'Opret hændelse' });
  await dialog.getByLabel('Hændelse').fill(title);
  await dialog.getByLabel('Påvirkning').fill('Dinero-ruter');
  await dialog.getByRole('button', { name: 'Gem' }).click();
  await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText('Undersøges');

  await page.getByRole('button', { name: 'Planlæg vedligehold' }).click();
  const m = page.getByRole('dialog', { name: 'Planlæg vedligehold' });
  await m.getByLabel('Hændelse').fill(`${title} (vedligehold)`);
  await m.getByRole('button', { name: 'Gem' }).click();
  await expect(page.getByRole('row', { name: /vedligehold/ }).first()).toContainText('Planlagt');

  const audit = await adminQuery<{ action: string }>(
    `select action from platform.audit where detail->>'title' like $1 order by created_at`,
    [`${title}%`],
  );
  expect(audit.map((a) => a.action)).toEqual(['incident.created', 'maintenance.planned']);
});

test('Produkt: a new Business price for new subscriptions only leaves existing ones unchanged', async ({
  page,
}) => {
  await login(page, 'kasper');
  const before = await adminQuery<{ id: string; price_version_id: string; price: number }>(
    `select s.id, s.price_version_id, v.price_monthly_ore as price from subscriptions s
       join plan_price_versions v on v.id = s.price_version_id where s.plan_id = 'business'`,
  );
  expect(before.length).toBeGreaterThan(0);
  const oldPrice = before[0]!.price;

  await page.goto('/platform/admin/product');
  await expect(page.getByRole('heading', { name: 'Produkt', exact: true })).toBeVisible();
  const price = page.getByLabel('Pris pr. måned for Business');
  await price.fill(String(oldPrice / 100 + 10));
  await page.getByRole('radio', { name: /Kun nye abonnementer/ }).check();
  await page.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByText(/1 plan er gemt/).filter({ visible: true })).toBeVisible();

  // The history has the new version with who and when.
  await page.getByRole('button', { name: 'Historik' }).click();
  const history = page.getByRole('dialog', { name: 'Historik' });
  await expect(history.getByRole('row').nth(1)).toContainText('Business');
  await expect(history.getByRole('row').nth(1)).toContainText('Kasper Nyborg');
  await expect(history.getByRole('row').nth(1)).toContainText('Kun nye abonnementer');
  await page.keyboard.press('Escape');

  // Existing subscriptions keep their version and price; the plan's list price is the new one.
  const after = await adminQuery<{ id: string; price_version_id: string; price: number }>(
    `select s.id, s.price_version_id, v.price_monthly_ore as price from subscriptions s
       join plan_price_versions v on v.id = s.price_version_id where s.plan_id = 'business'`,
  );
  expect(after).toEqual(before);
  const [plan] = await adminQuery<{ price: number }>(
    `select price_monthly_ore as price from plans where id = 'business'`,
  );
  expect(plan!.price).toBe(oldPrice + 1000);
  // A subscription that changes to Business now gets the new version (trigger).
  const [chosen] = await adminQuery<{ price: number }>(
    `select v.price_monthly_ore as price from plan_price_versions v
      where v.id = (select id from plan_price_versions where plan_id = 'business'
                    order by created_at desc limit 1)`,
  );
  expect(chosen!.price).toBe(oldPrice + 1000);
  const audit = await adminQuery(
    `select 1 from platform.audit where action = 'price_version.created'
        and detail->>'planId' = 'business' and created_at > now() - interval '1 minute'`,
  );
  expect(audit.length).toBe(1);

  // Back to the seed's price, again as a version for new subscriptions only.
  await page.reload();
  await page.getByLabel('Pris pr. måned for Business').fill(String(oldPrice / 100));
  await page.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByText(/1 plan er gemt/).filter({ visible: true })).toBeVisible();
});

async function tableRows(page: Page) {
  const rows = page.getByRole('table', { name: 'Fakturaer' }).getByRole('row');
  const out: { number: string; amount: string }[] = [];
  for (const row of (await rows.all()).slice(1)) {
    const cells = await row.getByRole('cell').allInnerTexts();
    out.push({ number: cells[0]!.trim(), amount: cells[7]!.trim() });
  }
  return out;
}

test('Rapporter: Fakturering for October exports CSV and PDF that match the table', async ({
  page,
}) => {
  await login(page, 'kasper');
  const started = new Date();
  await page.goto('/platform/admin/reports/revenue');
  await page
    .getByRole('navigation', { name: 'Rapporttype' })
    .getByRole('link', { name: 'Fakturering' })
    .click();
  await expect(page).toHaveURL(/\/platform\/admin\/reports\/invoicing/);
  await page.goto('/platform/admin/reports/invoicing?from=2026-10-01&to=2026-10-31');
  await expect(page.getByRole('heading', { name: 'Rapporter', exact: true })).toBeVisible();
  const shown = await tableRows(page);
  expect(shown.length).toBeGreaterThan(0);

  // CSV: a header row, ISO dates, a dot as decimal point, the same invoices and amounts.
  const csv = await page.request.get(
    '/platform/admin/reports/invoicing/export.csv?from=2026-10-01&to=2026-10-31',
  );
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(csv.headers()['content-disposition']).toContain('attachment');
  const lines = (await csv.text()).trim().split('\r\n');
  const cells = lines.map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
  expect(cells[0]).toEqual([
    'nummer',
    'kunde',
    'cvr',
    'type',
    'periode',
    'udstedt',
    'forfald',
    'betalt',
    'dage_til_betaling',
    'beloeb_inkl_moms',
    'status',
    'betalingsmetode',
  ]);
  const body = cells.slice(1);
  expect(body.length).toBe(shown.length);
  for (const r of body) {
    expect(r[5]).toMatch(/^2026-10-\d{2}$/);
    expect(r[9]).toMatch(/^\d+\.\d{2}$/);
  }
  const kr = (s: string) => Number(s.replace(/[^\d,]/g, '').replace(',', '.')).toFixed(2);
  expect(body.map((r) => [r[0], r[9]])).toEqual(shown.map((r) => [r.number, kr(r.amount)]));

  // PDF: the same invoice numbers and amounts, in Danish format.
  const pdf = await page.request.get(
    '/platform/admin/reports/invoicing/export.pdf?from=2026-10-01&to=2026-10-31',
  );
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const texts = pdfTexts(Buffer.from(await pdf.body()));
  expect(texts).toContain('Fakturering');
  for (const r of shown) {
    expect(texts).toContain(r.number);
    expect(texts).toContain(r.amount.replace(/\s/g, ' '));
  }

  // Both exports are in the platform audit log.
  const audit = await adminQuery<{ format: string }>(
    `select detail->>'format' as format from platform.audit where action = 'report.exported'
        and detail->>'report' = 'invoicing' and created_at >= $1
      order by created_at`,
    [started],
  );
  expect(audit.map((a) => a.format)).toEqual(['csv', 'pdf']);
});

test('Rapporter: Support og tid and Omsætning export for the chosen period', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/reports/support?from=2026-10-01&to=2026-10-31');
  await expect(page.getByRole('heading', { name: 'Tid pr. supporter' })).toBeVisible();
  for (const path of [
    '/platform/admin/reports/support/export.csv?from=2026-10-01&to=2026-10-31',
    '/platform/admin/reports/support/export.pdf?from=2026-10-01&to=2026-10-31',
    '/platform/admin/reports/revenue/export.csv?from=2026-09-01&to=2026-09-30',
    '/platform/admin/reports/revenue/export.pdf?from=2026-09-01&to=2026-09-30',
  ]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
  }
  const csv = await (
    await page.request.get(
      '/platform/admin/reports/support/export.csv?from=2026-10-01&to=2026-10-31',
    )
  ).text();
  expect(csv.split('\r\n')[1]).toContain('2026-10-01..2026-10-31');
});
