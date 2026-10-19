import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import globalSetup from './global-setup';
import { latestMailTo } from './mailpit';
import { base32Decode, login, totp } from './support';

/** M4 acceptance: sign-up, onboarding (D14), subscription and usage (D13), seats (D11). */

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

test('sign up, confirm the e-mail, onboard with CVR, card and a template (D14)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const email = `ejer.${Date.now()}@e2e.agentor.test`;
  // Generated per run: e2e never carries credential literals.
  const password = `E2e-${randomUUID()}`;

  await page.goto('/signup');
  await axe(page);
  await page.getByLabel('Dit navn').fill('Ida Ejer');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Adgangskode').fill(password);
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Opret konto' }).click();
  await expect(page.getByText(`Vi har sendt en mail til ${email}`)).toBeVisible({
    timeout: 20_000,
  });

  // Not verified yet: signing in is refused with a clear message.
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Adgangskode', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(page.getByText('Du skal bekræfte din e-mail')).toBeVisible();

  const mail = await latestMailTo(email);
  expect(mail.subject).toBe('Bekræft din e-mail til Agentor');
  const link = /https?:\/\/\S+verify-email\S+/.exec(mail.text)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/onboarding$/);

  // Step 1: CVR lookup (fixture provider in development).
  await expect(page.getByRole('heading', { name: 'Fortæl os om virksomheden' })).toBeVisible();
  await axe(page);
  await page.getByLabel('CVR-nummer').fill('12345678');
  await page.getByRole('button', { name: 'Slå op' }).click();
  await expect(page.getByRole('status')).toContainText('Nordlys Cykler ApS');
  await expect(page.getByRole('status')).toContainText('aktiv siden 2014');
  await page.getByLabel('E-mail til fakturaer').fill('regnskab@e2e.agentor.test');
  await page.getByLabel('Ordrer pr. måned, cirka').click();
  await page.getByRole('option', { name: '200–1.000' }).click();
  await page.getByRole('button', { name: 'Fortsæt' }).click();

  // Owners need two-step verification before they can continue.
  await expect(page).toHaveURL(/\/login\/mfa\/setup$/);
  await page.getByLabel('Bekræft med din adgangskode').fill(password);
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  const secret = (await page.locator('.font-mono').first().innerText()).trim();
  await page
    .getByLabel('Skriv den 6-cifrede kode fra appen')
    .fill(await totp(base32Decode(secret)));
  await page.getByRole('button', { name: 'Slå til' }).click();
  await page.getByRole('button', { name: 'Jeg har gemt koderne' }).click();

  // Step 2: plan (Business recommended for 200–1.000 orders) and card via the mock checkout.
  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await expect(page.getByText('Anbefalet ved 200–1.000 ordrer')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Business/ })).toBeChecked();
  await expect(
    page.getByText(/159,00\skr\.\s\+\smoms\s39,75\skr\.\s=\s198,75\skr\./),
  ).toBeVisible();
  await axe(page);
  await expect(page.getByRole('button', { name: 'Fortsæt' })).toBeDisabled();
  await page.getByRole('button', { name: 'Tilføj kort' }).click();
  await expect(page).toHaveURL(/\/checkout\/mock/);
  await expect(page.getByText(/198,75\skr\./)).toBeVisible();
  await page.getByRole('button', { name: 'Godkend kort' }).click();
  // The callback travels ingest → queue → worker; the page polls until the card is there.
  await expect(page.getByText('Visa •••• 4242 er tilføjet')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Fortsæt' }).click();

  // Step 3: skip the template; onboarding is done and Overblik opens.
  await expect(page).toHaveURL(/\/onboarding\/flow$/);
  await expect(page.getByRole('radio', { name: /Webshop til regnskab/ })).toBeChecked();
  await axe(page);
  await page.getByRole('button', { name: 'Spring over' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ida');

  await page.goto('/billing');
  await expect(page.getByText('Fornyes')).toContainText('Visa •••• 4242');
});

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
  await expect(page.getByText('2 eksterne brugere')).toBeVisible();

  const startup = page.getByRole('region', { name: 'Startup', exact: true });
  await expect(startup.getByRole('button', { name: 'Nedgradér' })).toBeDisabled();
  await expect(startup).toContainText('Kan ikke vælges: du er over grænsen for');
  const business = page.getByRole('region', { name: 'Business', exact: true });
  await expect(business).toContainText('Din plan');

  const invoices = page.getByRole('table');
  // Three subscription invoices and three support invoices (Finans, M9); drafts never show.
  await expect(invoices.getByRole('row')).toHaveCount(7);
  await expect(invoices).toContainText('AG-2026-1043');
  await expect(invoices).toContainText('Support · ');
  await expect(invoices).toContainText('198,75 kr.');
  await expect(invoices).toContainText('Betalt');
  await axe(page);

  const download = page.waitForEvent('download');
  await invoices.getByRole('link', { name: 'Hent faktura AG-2026-1043 som PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('AG-2026-1043.pdf');
});

test('upgrade to Enterprise; Business is then blocked while over its seats', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/billing');
  await page.getByRole('button', { name: 'Opgradér til Enterprise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Opgradér til Enterprise?' });
  await dialog.getByRole('button', { name: 'Opgradér til Enterprise' }).click();
  await expect(page.getByText('Du er nu på Enterprise')).toBeVisible();
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
  await expect(page.getByText('4 af 3 pladser brugt')).toBeVisible();
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
  await expect(page.getByText('Du betaler årligt fra næste fornyelse')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Business' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Skift til månedlig' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Skift til månedlig' }).click();
  await expect(page.getByText('Du betaler månedligt fra næste fornyelse')).toBeVisible();
});
