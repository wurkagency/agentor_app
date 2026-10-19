import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { latestMailTo } from './mailpit';
import { login } from './support';

/** M3 acceptance: team, invitations, settings and audit log (D11, D12). */

test.describe.configure({ mode: 'serial' });

test('team list shows roles, per-flow access, external users and MFA state (D11-Team)', async ({
  page,
}) => {
  await login(page, 'mette');
  await page.goto('/settings/team');
  const table = page.getByRole('table').first();
  await expect(table.getByRole('row')).toHaveCount(5);
  const sara = table.getByRole('row', { name: /Sara Lind/ });
  await expect(sara).toContainText('Udvikler');
  await expect(sara).toContainText('1 flow: Webshop → regnskab og CRM');
  await expect(sara).toContainText('Udløber 12. nov. 2026');
  await expect(sara).toContainText('Ekstern');
  const bo = table.getByRole('row', { name: /Bo Dahl/ });
  await expect(bo).toContainText('Alle flows · kun læse');
  await expect(bo).toContainText('Mangler');
  await expect(page.getByText(/4 brugere/)).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('invite a reader by e-mail; they create an account and join (D11-Inviter)', async ({
  page,
  browser,
}) => {
  const email = `ny.bogholder.${Date.now()}@example.test`;
  await login(page, 'mette');
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Invitér' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invitér bruger' });
  await dialog.getByLabel('E-mail').fill(email);
  await dialog.getByText('Læser', { exact: true }).click();
  await dialog.getByText('Alle flows', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitationen er sendt til ${email}`)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ventende invitationer' })).toContainText(email);

  const mail = await latestMailTo(email);
  expect(mail.subject).toContain('Nordlys Cykler ApS');
  const link = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(mail.text)?.[0];
  expect(link).toBeTruthy();

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(new URL(link!).pathname);
  await expect(invitee.getByText('Nordlys Cykler ApS har inviteret dig som læser.')).toBeVisible();
  await invitee.getByLabel('Dit navn').fill('Ny Bogholder');
  await invitee.getByLabel('Vælg adgangskode').fill('En-lang-adgangskode-42');
  await invitee.getByRole('button', { name: 'Opret konto og acceptér' }).click();
  await expect(invitee).toHaveURL(/\/$/);
  await expect(invitee.getByRole('heading', { level: 1 })).toContainText('Ny');

  // The link can't be used twice.
  await invitee.goto(new URL(link!).pathname);
  await expect(invitee.getByText('Invitationen er ikke længere gyldig')).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole('table')
      .first()
      .getByRole('row', { name: /Ny Bogholder/ }),
  ).toContainText('Læser');
});

test('change a role and access in one go; the audit log records it', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Handlinger for Sara Lind' }).click();
  await page.getByRole('menuitem', { name: 'Redigér rolle og adgang' }).click();
  const dialog = page.getByRole('dialog', { name: /Rolle og adgang for Sara Lind/ });
  await dialog.getByText('Læser', { exact: true }).click();
  await expect(dialog.getByText('Personen bliver logget ud')).toBeVisible();
  await dialog.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByText('Ændringerne er gemt')).toBeVisible();
  await expect(page.getByRole('row', { name: /Sara Lind/ })).toContainText('Læser');

  await page.goto('/settings/audit-log');
  await expect(page.getByRole('table')).toContainText('Ændrede rolle');
  await expect(page.getByRole('table')).toContainText('Mette Holm');
});

test('removing a member requires typing their name', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Handlinger for Ny Bogholder' }).click();
  await page.getByRole('menuitem', { name: 'Fjern fra teamet' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Fjern bruger' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Skriv brugerens navn for at bekræfte').fill('Ny Bogholder');
  await confirm.click();
  await expect(page.getByText('Ny Bogholder er fjernet fra teamet')).toBeVisible();
  await expect(page.getByRole('row', { name: /Ny Bogholder/ })).toHaveCount(0);
});

test('an admin cannot manage the owner', async ({ page }) => {
  await login(page, 'jonas');
  await page.goto('/settings/team');
  await expect(page.getByRole('button', { name: 'Handlinger for Mette Holm' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Handlinger for Bo Dahl' })).toBeVisible();
});

test('company details save and appear in the audit log', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/settings/company');
  await page.getByLabel('CVR-nummer').fill('1234');
  await page.getByLabel('CVR-nummer').blur();
  await expect(page.getByText('Et CVR-nummer har 8 cifre.')).toBeVisible();
  await page.getByLabel('CVR-nummer').fill('12345678');
  await page.getByLabel('By', { exact: true }).fill('Aarhus N');
  await page.getByRole('button', { name: 'Gem', exact: true }).click();
  await expect(page.getByText('Virksomhedens oplysninger er gemt')).toBeVisible();
  await page.goto('/settings/audit-log?group=company');
  await expect(page.getByRole('table')).toContainText('Ændrede virksomhedens oplysninger');
});

test('notification choices are personal and persist; critical in-app is locked (D12)', async ({
  page,
}) => {
  await login(page, 'bo');
  await page.goto('/settings/notifications');
  await expect(page.getByLabel("Forbindelse afbrudt: I app'en (Kan ikke slås fra)")).toBeDisabled();
  await expect(page.getByLabel('Systematisk fejl: % fejlrate')).toHaveCount(0);
  const box = page.getByLabel('Enkelt record fejlet: E-mail');
  await expect(box).not.toBeChecked();
  await box.click();
  await page.getByRole('button', { name: 'Gem', exact: true }).click();
  await expect(page.getByText('Notifikationerne er gemt')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Enkelt record fejlet: E-mail')).toBeChecked();
  // Bo is a reader: thresholds are read-only for him.
  await expect(page.getByLabel('fejl i træk')).toBeDisabled();
});

test('requiring MFA for the whole team sends a reader to enrolment', async ({ page, browser }) => {
  await login(page, 'mette');
  await page.goto('/settings/security');
  const toggle = page.getByRole('switch', { name: 'Kræv totrin for hele teamet' });
  await toggle.click();
  await expect(page.getByText('Sikkerhedsindstillingerne er gemt')).toBeVisible();
  await expect(page.getByText(/Bo Dahl.*har ikke slået totrin til endnu/)).toBeVisible();

  const bo = await (await browser.newContext()).newPage();
  await bo.goto('/login');
  await bo.getByLabel('E-mail').fill('bo@dahl-revision.dk');
  await bo.getByLabel('Adgangskode', { exact: true }).fill('Nordlys-demo-2026!');
  await bo.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(bo).toHaveURL(/\/login\/mfa\/setup$/);

  await page.getByRole('switch', { name: 'Kræv totrin for hele teamet' }).click();
  await expect(page.getByText('Sikkerhedsindstillingerne er gemt').first()).toBeVisible();
});

test('audit log exports CSV with the active filters', async ({ page }) => {
  await login(page, 'mette');
  const res = await page.request.get('/settings/audit-log/export?group=member');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body.split('\r\n')[0]).toContain('"Tid";"Hvem";"Handling"');
  expect(body).toContain('member.');
  expect(body).not.toContain('company.updated');
});

test('a reader sees personal settings but not the team or audit log', async ({ page }) => {
  await login(page, 'bo');
  await page.goto('/settings/notifications');
  const nav = page.getByRole('navigation', { name: 'Sekundær navigation' });
  await expect(nav.getByRole('link')).toHaveText(['Notifikationer', 'Sikkerhed', 'Min profil']);
  await page.goto('/settings/team');
  await expect(page.getByText('Du har ikke adgang til denne side')).toBeVisible();
  const csv = await page.request.get('/settings/audit-log/export');
  expect(csv.status()).not.toBe(200);
});

test('backup codes can be regenerated with the password', async ({ page }) => {
  await login(page, 'jonas');
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Lav nye reservekoder' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bekræft med din adgangskode').fill('Nordlys-demo-2026!');
  await dialog.getByRole('button', { name: 'Fortsæt' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(8);
});
