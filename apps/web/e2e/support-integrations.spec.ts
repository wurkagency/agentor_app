import { expect, test } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { adminQuery, login } from './support';

// Agentor support under a help grant can support and test the customer's integrations: new
// flows from templates, and adding connections with a key or the provider's login. Everything
// lands in the customer's audit log as support. Team, billing and settings stay closed.
test.describe.configure({ mode: 'serial' });

test('support in the customer’s app adds connections and opens new integrations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const since = new Date().toISOString();
  await login(page, 'kasper');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Åbn kundens app' }).click();
  await expect(page.getByRole('region', { name: 'Supportvisning' })).toBeVisible();
  const closed = page.getByText('Du har ikke adgang til denne side').filter({ visible: true });

  for (const path of ['/integrations/new', '/integrations/templates', '/connections/new']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(closed).toHaveCount(0);
  }

  // A key: sealed in the browser session like the customer's own.
  await page.getByRole('button', { name: 'Tilføj konto Brevo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forbind Brevo' });
  await dialog.getByLabel('API-nøgle').fill('xkeysib-e2e-support');
  await dialog.getByRole('button', { name: 'Forbind' }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);

  // The provider's login (the mock consent page in test mode), under the help grant.
  await page.goto('/connections/new');
  await page.getByRole('button', { name: 'Tilføj konto Dinero' }).click();
  await page
    .getByRole('link', { name: 'Giv adgang' })
    .or(page.getByRole('button', { name: 'Giv adgang' }))
    .click();
  await expect(page).toHaveURL(/\/connections/);
  await expect(closed).toHaveCount(0);

  const audit = await adminQuery<{ actor_kind: string; n: number }>(
    `select actor_kind, count(*)::int as n from audit_log
      where tenant_id = $1 and action = 'connection.created' and created_at >= $2
      group by actor_kind`,
    [TENANTS.nordlys.id, since],
  );
  expect(audit).toEqual([{ actor_kind: 'support', n: 2 }]);

  // Still never team settings.
  await page.goto('/settings/team');
  await expect(closed).toBeVisible();

  await adminQuery(`delete from connections where tenant_id = $1 and created_at >= $2`, [
    TENANTS.nordlys.id,
    since,
  ]);
});
