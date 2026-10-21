import { expect, test, type Page } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { latestMailTo } from './mailpit';
import { adminQuery, fullLogin, login } from './support';

// Customer administration in Platform (Superadmin): edit, a new owner invitation, suspend and
// reactivate, delete. Everything is audit-logged; a suspended company can't open the app.
test.describe.configure({ mode: 'serial' });

const inviteLink = (text: string) => /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(text)![0];

async function adminMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Administrér' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('edit, resend the owner invitation, suspend, reactivate and delete a customer', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = `e2e-admin-${Date.now()}@example.test`;
  const name = `E2E Admin ${Date.now()} ApS`;
  await login(page, 'kasper');
  await page.goto('/platform/customers');
  await page.getByRole('button', { name: 'Opret kunde' }).click();
  const create = page.getByRole('dialog', { name: 'Opret kunde' });
  await create.getByLabel('Firmanavn').fill(name);
  await create.getByLabel('Ejerens e-mail').fill(owner);
  await create.getByRole('button', { name: 'Opret og send invitation' }).click();
  await expect(page).toHaveURL(/\/platform\/customers\/[0-9a-f-]{36}\?created=1$/);
  const tenantId = /customers\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const firstLink = inviteLink((await latestMailTo(owner, 20_000)).text);

  // Edit the details.
  await adminMenu(page, 'Redigér oplysninger');
  const edit = page.getByRole('dialog', { name: 'Redigér kundens oplysninger' });
  await edit.getByLabel('Firmanavn').fill(`${name} Ny`);
  await edit.getByLabel('By').fill('Aarhus');
  await edit.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByRole('heading', { name: `${name} Ny`, level: 1 })).toBeVisible();

  // A new owner invitation; the first link stops working.
  await adminMenu(page, 'Send ny invitation til ejeren');
  await page
    .getByRole('dialog', { name: 'Send ny invitation til ejeren' })
    .getByRole('button', { name: 'Send invitation' })
    .click();
  await expect(page.getByText(`Invitationen er sendt til ${owner}`).first()).toBeVisible();
  await expect
    .poll(async () => inviteLink((await latestMailTo(owner, 20_000)).text))
    .not.toBe(firstLink);
  const old = await (await browser.newContext()).newPage();
  await old.goto(new URL(firstLink).pathname);
  await expect(old.getByText('Invitationen er ikke længere gyldig')).toBeVisible();
  await old.context().close();

  // Suspend with a reason, then reactivate.
  await adminMenu(page, 'Suspendér kunde');
  const suspend = page.getByRole('dialog', { name: /^Suspendér / });
  await expect(suspend.getByRole('button', { name: 'Suspendér' })).toBeDisabled();
  await suspend.getByLabel('Begrundelse').fill('E2E: test af suspendering');
  await suspend.getByRole('button', { name: 'Suspendér' }).click();
  await expect(page.getByText(/^Kunden er suspenderet\. Ingen i virksomheden/)).toBeVisible();
  await adminMenu(page, 'Genaktivér kunde');
  await page
    .getByRole('dialog', { name: /^Genaktivér / })
    .getByRole('button', { name: 'Genaktivér kunde' })
    .click();
  await expect(page.getByText(/^Kunden er suspenderet\. Ingen i virksomheden/)).toHaveCount(0);

  const audit = await adminQuery<{ action: string }>(
    `select action from audit_log where tenant_id = $1 and actor_kind = 'support' order by created_at`,
    [tenantId],
  );
  expect(audit.map((a) => a.action)).toEqual([
    'company.created_by_staff',
    'company.updated_by_staff',
    'invitation.resent_by_staff',
    'company.suspended',
    'company.reactivated',
  ]);

  // Delete: the name must be typed.
  await adminMenu(page, 'Slet kunde');
  const del = page.getByRole('dialog', { name: /^Slet / });
  const button = del.getByRole('button', { name: 'Slet kunde' });
  await expect(button).toBeDisabled();
  await del.getByRole('textbox').fill(`${name} Ny`);
  await button.click();
  await expect(page).toHaveURL(/\/platform\/customers$/);
  expect(await adminQuery(`select 1 from tenants where id = $1`, [tenantId])).toEqual([]);
  const log = await adminQuery(
    `select 1 from platform.audit where action = 'customer.deleted' and detail->>'tenantId' = $1`,
    [tenantId],
  );
  expect(log.length).toBe(1);
});

test('a suspended company opens the suspended page instead of the app', async ({
  page,
  browser,
}) => {
  await login(page, 'kasper');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await adminMenu(page, 'Suspendér kunde');
  const suspend = page.getByRole('dialog', { name: /^Suspendér / });
  await suspend.getByLabel('Begrundelse').fill('E2E: suspenderet');
  await suspend.getByRole('button', { name: 'Suspendér' }).click();
  await expect(page.getByText(/^Kunden er suspenderet\. Ingen i virksomheden/)).toBeVisible();
  try {
    const jonas = await (await browser.newContext()).newPage();
    await fullLogin(jonas, 'jonas').catch(() => undefined);
    await jonas.goto('/');
    await expect(jonas).toHaveURL(/\/suspended$/);
    await expect(jonas.getByRole('heading', { name: 'Kontoen er suspenderet' })).toBeVisible();
    await jonas.context().close();
  } finally {
    await adminQuery(`update tenants set status = 'active' where id = $1`, [TENANTS.nordlys.id]);
  }
});

test('a Support Agent has no customer administration', async ({ page }) => {
  await login(page, 'anne');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administrér' })).toHaveCount(0);
});
