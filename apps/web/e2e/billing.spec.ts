import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import globalSetup from './global-setup';
import { login } from './support';

/** M4 acceptance: subscription and usage (D13), seats (D11). Signup and onboarding: signup.spec.ts, onboarding.spec.ts. */

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

test('subscription page: plan, meters, blocked downgrade and invoices (D13)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Abonnement og forbrug' })).toBeVisible();
  await expect(page.getByText('Fornyes')).toContainText('Visa •••• 4242');
  await expect(page.getByRole('meter', { name: 'Transaktioner' }).first()).toHaveAttribute(
    'aria-valuenow',
    '71',
  );
  await expect(page.getByText('712 / 1.000').first()).toBeVisible();
  await expect(page.getByText('2 eksterne brugere').filter({ visible: true })).toBeVisible();

  const startup = page.getByRole('region', { name: 'Startup', exact: true });
  await expect(startup.getByRole('button', { name: 'Nedgradér' })).toBeDisabled();
  await expect(startup).toContainText('Kan ikke vælges: du er over grænsen for');
  const business = page.getByRole('region', { name: 'Business', exact: true });
  await expect(business).toContainText('Din plan');

  const invoices = page.getByRole('table');
  // Three subscription invoices and three support invoices (Finans, M9); drafts never show.
  await expect(invoices.getByRole('row')).toHaveCount(7);
  await expect(invoices).toContainText('INV/2026/01043');
  await expect(invoices).toContainText('Support · ');
  await expect(invoices).toContainText('198,75 kr.');
  await expect(invoices).toContainText('Betalt');
  await axe(page);

  const download = page.waitForEvent('download');
  await invoices.getByRole('link', { name: 'Hent faktura INV/2026/01043 som PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('INV-2026-01043.pdf');
});

test('upgrade to Enterprise; Business is then blocked while over its seats', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/billing');
  await page.getByRole('button', { name: 'Opgradér til Enterprise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Opgradér til Enterprise?' });
  await dialog.getByRole('button', { name: 'Opgradér til Enterprise' }).click();
  await expect(page.getByText('Du er nu på Enterprise').filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Enterprise', exact: true })).toContainText(
    'Din plan',
  );

  // Four users on three Business seats: the downgrade waits until a seat is freed.
  const business = page.getByRole('region', { name: 'Business', exact: true });
  await expect(business.getByRole('button', { name: 'Nedgradér' })).toBeDisabled();
  await expect(business).toContainText('du er over grænsen for brugere på Business');
  globalSetup();
});

test('the transaction meter is in the secondary bar for every member', async ({ page }) => {
  await login(page, 'bo');
  await page.goto('/integrations');
  const meter = page.getByRole('meter', { name: 'Transaktioner' });
  await expect(meter).toHaveAttribute('aria-valuetext', '712 / 1.000');
  // Bo is a reader: no link to Abonnement, and the page itself is closed to him.
  await expect(page.getByRole('link', { name: /Transaktioner/ })).toHaveCount(0);
  const res = await page.goto('/billing');
  expect(res?.status()).toBe(403);
});

test('a plan with no free seats refuses further invitations (D11)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/settings/team');
  // Every user takes a seat, external users included: the seed customer is over its 3 seats
  // (Mette, Jonas, Sara and Bo), so no invitation goes through.
  await expect(page.getByText('4 af 3 pladser brugt').filter({ visible: true })).toBeVisible();
  const invite = async (email: string) => {
    await page.getByRole('button', { name: 'Invitér' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invitér bruger' });
    await dialog.getByLabel('E-mail').fill(email);
    await dialog.getByText('Læser', { exact: true }).click();
    await dialog.getByText('Alle flows', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    return dialog;
  };
  const dialog = await invite(`ingen.plads.${Date.now()}@example.test`);
  await expect(dialog.getByText('Planen har ikke flere pladser')).toBeVisible();
});

test('the owner switches to yearly billing from the next renewal (D13)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/billing');
  await page.getByRole('button', { name: 'Skift til årlig' }).click();
  const dialog = page.getByRole('dialog', { name: 'Skift til årlig' });
  await expect(dialog).toContainText('1.590 kr./år');
  await dialog.getByRole('button', { name: 'Skift til årlig' }).click();
  await expect(
    page.getByText('Du betaler årligt fra næste fornyelse').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Business' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Skift til månedlig' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Skift til månedlig' }).click();
  await expect(
    page.getByText('Du betaler månedligt fra næste fornyelse').filter({ visible: true }),
  ).toBeVisible();
});
