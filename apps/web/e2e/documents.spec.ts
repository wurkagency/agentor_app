import { expect, test, type APIRequestContext } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { adminQuery, login } from './support';

/**
 * Invoices and credit notes as documents (I01/I02, PLAN-EMAILS-PDF §6–7): Superadmin credits part
 * of a card-paid support invoice on F4 and the money goes back through (mock) QuickPay; the owner
 * sees the credit note and both PDFs under Abonnement › Fakturaer; nobody else gets them. PDFs
 * come through a signed, short-lived link to the stored file.
 */

test.describe.configure({ mode: 'serial' });

const INVOICE = '0190b000-0000-7000-8000-00000000d0c1';
const NUMBER = 'INV/2026/99901';
const LINES = [
  {
    text: '#2271 Ordrer synkroniseres dobbelt',
    amountOre: 144000,
    caseNumber: 2271,
    registeredMinutes: 125,
    billedMinutes: 135,
    rateOre: 64000,
    log: [
      { date: '2026-10-02', registeredMinutes: 50, billedMinutes: 60 },
      { date: '2026-10-07', registeredMinutes: 75, billedMinutes: 75 },
    ],
  },
  {
    text: '#2291 Fakturaer til EU-kunder fejler',
    amountOre: 96000,
    caseNumber: 2291,
    registeredMinutes: 87,
    billedMinutes: 90,
    rateOre: 64000,
    log: [{ date: '2026-10-19', registeredMinutes: 87, billedMinutes: 90 }],
  },
];

async function cleanup() {
  await adminQuery(
    `delete from app.documents where ref_id = $1 or ref_id in (select id from credit_notes where invoice_id = $1)`,
    [INVOICE],
  );
  await adminQuery(`delete from audit_log where action like 'credit_note.%' and tenant_id = $1`, [
    TENANTS.nordlys.id,
  ]);
  await adminQuery(`delete from credit_notes where invoice_id = $1`, [INVOICE]);
  await adminQuery(`delete from invoices where id = $1`, [INVOICE]);
}

/** Follows the route's redirect to the signed link and returns the PDF. */
async function pdfFrom(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const location = res.headers().location!;
  expect(location).toMatch(/^\/api\/documents\/[0-9a-f-]{36}\?exp=\d+&sig=[\w-]+$/);
  const file = await request.get(location);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  return { location, body: (await file.body()).toString('latin1') };
}

test.beforeAll(async () => {
  await cleanup();
  await adminQuery(
    `insert into invoices (tenant_id, id, number, kind, status, period_start, period_end, description,
                           lines, amount_ore, vat_ore, payment_method, provider_payment_id, paid_at, issued_at, due_at)
     values ($1, $2, $3, 'support', 'paid', '2025-01-01T00:00:00+01:00', '2025-02-01T00:00:00+01:00',
             'Support · januar 2025', $4::jsonb, 240000, 60000, 'card', 'mock_pay_e2e', now(), now(), now())`,
    [TENANTS.nordlys.id, INVOICE, NUMBER, JSON.stringify(LINES)],
  );
});
test.afterAll(cleanup);

test('the owner downloads the invoice PDF through a signed link; nobody else can', async ({
  page,
  browser,
}) => {
  await login(page, 'mette');
  const { location, body } = await pdfFrom(page.request, `/billing/invoices/${INVOICE}/pdf`);
  expect(body).toContain('(INV/2026/99901)');
  expect(body).toContain('(FAKTURA)');
  // The same state is stored once: a second download gets the same file.
  const again = await pdfFrom(page.request, `/billing/invoices/${INVOICE}/pdf`);
  expect(again.location.split('?')[0]).toBe(location.split('?')[0]);
  // A tampered link is refused.
  const bad = await page.request.get(location.replace(/sig=[\w-]+/, 'sig=nope'));
  expect(bad.status()).toBe(404);

  // A member who is not the owner gets nothing.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, 'jonas');
  const res = await other.request.get(`/billing/invoices/${INVOICE}/pdf`, { maxRedirects: 0 });
  expect(res.status()).not.toBe(303);
  await ctx.close();
});

test('Superadmin credits part of the invoice on F4, refunded to the card', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto(`/platform/finance/customers/${TENANTS.nordlys.id}`);
  await page
    .getByRole('button', { name: `Kreditér faktura ${NUMBER}` })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('#2271 Ordrer synkroniseres dobbelt')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Delvis kredit' }).click();
  await dialog.getByRole('checkbox', { name: '#2271 Ordrer synkroniseres dobbelt' }).click();
  await dialog.getByRole('textbox', { name: /#2271.*timer/ }).fill('0,5');
  await dialog
    .getByLabel('Årsag')
    .fill('Fejl hos Agentor: 30 min. på sag #2271 skulle ikke have været faktureret.');
  await expect(dialog.getByText('Krediteres i alt 400,00')).toBeVisible();
  await dialog.getByRole('button', { name: 'Opret kreditnota' }).click();
  await expect(page.getByText(/Kreditnota K-\d{4}-\d{4,} er oprettet/).first()).toBeVisible();

  const [note] = await adminQuery<{
    id: string;
    number: string;
    net_ore: number;
    vat_ore: number;
    refund_state: string;
  }>(`select id, number, net_ore, vat_ore, refund_state from credit_notes where invoice_id = $1`, [
    INVOICE,
  ]);
  expect(note).toMatchObject({ net_ore: -32000, vat_ore: -8000, refund_state: 'done' });
  // The original invoice is unchanged.
  const [inv] = await adminQuery<{ amount_ore: number; status: string }>(
    `select amount_ore, status from invoices where id = $1`,
    [INVOICE],
  );
  expect(inv).toEqual({ amount_ore: 240000, status: 'paid' });
  const audit = await adminQuery(
    `select 1 from audit_log where tenant_id = $1 and object_id = $2 and action = 'credit_note.created'`,
    [TENANTS.nordlys.id, note!.id],
  );
  expect(audit).toHaveLength(1);

  await page.reload();
  const row = page.getByRole('row', { name: new RegExp(note!.number) });
  await expect(row.getByText('Tilbageført')).toBeVisible();
  const { body } = await pdfFrom(
    page.request,
    `/platform/finance/credit-notes/${TENANTS.nordlys.id}/${note!.id}/pdf`,
  );
  expect(body).toContain(`(${note!.number})`);
  expect(body).toContain('(KREDITNOTA)');
});

test('a credit can never exceed what is left of the invoice', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto(`/platform/finance/customers/${TENANTS.nordlys.id}`);
  await page
    .getByRole('button', { name: `Kreditér faktura ${NUMBER}` })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Delvis kredit' }).click();
  await dialog.getByRole('checkbox', { name: '#2271 Ordrer synkroniseres dobbelt' }).click();
  // 2,25 h were invoiced and 0,5 h credited: 2 h is more than is left.
  await dialog.getByRole('textbox', { name: /#2271.*timer/ }).fill('2');
  await dialog.getByLabel('Årsag').fill('For meget');
  await expect(dialog.getByRole('button', { name: 'Opret kreditnota' })).toBeDisabled();
});

test('the owner sees the credit note under Fakturaer and downloads it', async ({
  page,
  browser,
}) => {
  await login(page, 'mette');
  await page.goto('/billing/invoices');
  await expect(page.getByRole('heading', { name: 'Kreditnotaer' })).toBeVisible();
  const [note] = await adminQuery<{ id: string; number: string }>(
    `select id, number from credit_notes where invoice_id = $1`,
    [INVOICE],
  );
  const row = page.getByRole('row', { name: new RegExp(note!.number) });
  await expect(row.getByText(`Krediterer faktura ${NUMBER}`)).toBeVisible();
  await expect(row.getByText('-400,00 kr.').or(row.getByText('−400,00 kr.'))).toBeVisible();
  const { body } = await pdfFrom(page.request, `/billing/credit-notes/${note!.id}/pdf`);
  expect(body).toContain('(Tilbagef\\370rt)');

  // Another company's owner can't get it, even with the id.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, 'bo');
  const res = await other.request.get(`/billing/credit-notes/${note!.id}/pdf`, { maxRedirects: 0 });
  expect(res.status()).not.toBe(303);
  await ctx.close();
});

test('Superadmin fills in the company details shown on the documents', async ({ page }) => {
  await login(page, 'kasper');
  await page.goto('/platform/admin/product');
  await expect(page.getByText('Firmaoplysninger på fakturaer').first()).toBeVisible();
  await page.getByLabel('CVR', { exact: true }).filter({ visible: true }).fill('123');
  await page
    .getByRole('button', { name: 'Gem firmaoplysninger' })
    .filter({ visible: true })
    .click();
  await expect(page.getByText('Firmaoplysningerne kunne ikke gemmes').first()).toBeVisible();
  await page.getByLabel('CVR', { exact: true }).filter({ visible: true }).fill('');
  await page
    .getByRole('button', { name: 'Gem firmaoplysninger' })
    .filter({ visible: true })
    .click();
  await expect(page.getByText('Firmaoplysningerne er gemt').first()).toBeVisible();
});
