import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { CONNECTIONS, SEED_WOO_WEBHOOK_TOKEN } from '../scripts/seed-data';
import globalSetup from './global-setup';
import { login } from './support';

/** M5 acceptance: connections (D9), key box, webhook ingest. */

test.describe.configure({ mode: 'serial' });

// Start from the seeded accounts, also when CI retries the serial group after a failure.
test.beforeAll(() => globalSetup());

const INGEST = process.env.INGEST_INTERNAL_URL ?? 'http://127.0.0.1:3100';

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

test('my connections: six accounts, one broken (D9-Forbindelser)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/connections');
  await expect(
    page.getByText('6 forbindelser · 1 afbrudt').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(6);
  const economic = card(page, 'e-conomic');
  await expect(economic).toContainText('Afbrudt');
  await expect(economic.getByRole('link', { name: 'Genautentificér' })).toBeVisible();
  await expect(card(page, 'WooCommerce')).toContainText('Webhook modtaget');
  await expect(card(page, 'Dinero')).toContainText('14. jan. 2027');
  await axe(page);
});

test('catalogue lists 23 systems in five groups (D9-Katalog)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/connections/new');
  await expect(page.getByRole('listitem')).toHaveCount(23);
  // Systems that aren't ready promise nothing: no waitlist button.
  await expect(page.getByRole('button', { name: /Magento/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tilføj konto Dinero' })).toBeVisible();
  await page.getByRole('button', { name: 'CRM', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await axe(page);
});

test('connect Brevo with an API key; the worker checks it', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/connections/new');
  await page.getByRole('button', { name: 'Tilføj konto Brevo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forbind Brevo' });
  await dialog.getByLabel('API-nøgle').fill('xkeysib-e2e-nyt-nyhedsbrev');
  await dialog.getByRole('button', { name: 'Forbind' }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);
  // Sealed in the browser session → worker opens with the KEK → test → Aktiv.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Brevo');
  await expect(page.getByText('Aktiv', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText('Nøgler vises aldrig, heller ikke maskeret.').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('xkeysib-e2e');
});

test('a revoked key shows the broken state, and reconnecting fixes it (D9-Dinero-Afbrudt)', async ({
  page,
}) => {
  await login(page, 'mette');
  await page.goto(`/connections/${CONNECTIONS.economic.id}`);
  // Next's route announcer is an alert too (empty), so match the banner by its text.
  const broken = page
    .getByRole('alert')
    .filter({ hasText: 'Forbindelsen til e-conomic er afbrudt.' });
  await expect(broken).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Genautentificér' }).click();
  const dialog = page.getByRole('dialog', { name: 'Genautentificér' });
  await dialog.getByLabel('Agreement grant token').fill('new-e2e-grant-token');
  await dialog.getByRole('button', { name: 'Gem' }).click();
  await expect(broken).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Aktiv', { exact: true }).first()).toBeVisible();
});

test('connect HubSpot through the provider sign-in (mock OAuth)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/connections/new');
  await page.getByRole('button', { name: 'Tilføj konto HubSpot' }).click();
  await expect(page).toHaveURL(/\/connect\/hubspot$/);
  await expect(page.getByRole('heading', { name: 'Giv Agentor adgang til HubSpot' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Giv adgang' }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Aktiv', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Disconnecting asks for the name and removes it.
  const name = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
  await page.getByRole('button', { name: 'Afbryd forbindelse' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Afbryd forbindelse' }).click();
  await expect(page).toHaveURL(/\/connections$/);
  await expect(page.getByText(`${name} er afbrudt`)).toBeVisible();
});

test('webhooks: a signed delivery is accepted, a forged one is not (§9.4)', async ({ page }) => {
  const body = JSON.stringify({ id: 10448, status: 'processing' });
  const post = (sig: string) =>
    fetch(`${INGEST}/hooks/${SEED_WOO_WEBHOOK_TOKEN}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wc-webhook-topic': 'order.created',
        'x-wc-webhook-signature': sig,
      },
      body,
    });
  const unknown = await fetch(`${INGEST}/hooks/${'x'.repeat(43)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  expect(unknown.status).toBe(404);

  // A forged signature is stored but rejected by the worker; the timestamp doesn't move.
  expect(
    (await post(createHmac('sha256', randomBytes(32)).update(body).digest('base64'))).status,
  ).toBe(202);
  const good = createHmac('sha256', CONNECTIONS.woo.credentials.consumerSecret)
    .update(body)
    .digest('base64');
  expect((await post(good)).status).toBe(202);

  await login(page, 'mette');
  await expect(async () => {
    await page.goto('/connections');
    await expect(card(page, 'WooCommerce')).toContainText('Webhook modtaget lige nu', {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
});

test('readers see connections but cannot manage them', async ({ page }) => {
  await login(page, 'bo');
  await page.goto('/connections');
  await expect(card(page, 'Dinero')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tilføj forbindelse' })).toHaveCount(1); // nav pill only
  await expect(page.getByRole('link', { name: 'Genautentificér' })).toHaveCount(0);
  const res = await page.goto('/connections/new');
  expect(res?.status()).toBe(403);
  await page.goto(`/connections/${CONNECTIONS.dinero.id}`);
  await expect(page.getByRole('button', { name: 'Test forbindelse' })).toHaveCount(0);
});
