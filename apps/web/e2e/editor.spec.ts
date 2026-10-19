import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FLOWS } from '../scripts/seed-data';
import globalSetup from './global-setup';
import { login } from './support';

/**
 * M7 acceptance: the Phase 1 prototype path (Overblik → Integrationer → editor → fix the stale
 * EU B2B account → test run → publish as draft → "Alt kører"), plus the editor's read-only modes
 * and the template picker. Runs on the "gate" seed and puts the board seed back afterwards.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  process.env.SEED_SCENARIO = 'gate';
  globalSetup();
});
test.afterAll(() => {
  delete process.env.SEED_SCENARIO;
  // E2E_KEEP_STATE=1 leaves the gate state in place for debugging.
  if (!process.env.E2E_KEEP_STATE) globalSetup();
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    // React Flow draws edges as SVG paths; the canvas is covered by the list view instead.
    .exclude('.react-flow__renderer')
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

const WEBSHOP = FLOWS.webshop.id;

test('Phase 1 gate: fix the EU B2B account and publish as draft', async ({ page }) => {
  // 1. Overblik shows the problem.
  await login(page, 'mette');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '1 flow kræver handling' })).toBeVisible();
  await expect(page.getByText('Konto 1010 findes ikke i Dinero.')).toBeVisible();

  // 2–4. Integrationer, expand the flow, open the editor.
  await page.getByRole('navigation').getByRole('link', { name: 'Integrationer' }).first().click();
  await expect(page).toHaveURL(/\/integrations$/);
  const row = page.getByRole('row', { name: /Webshop → regnskab og CRM/ });
  const expand = page.getByRole('button', { name: 'Fold Webshop → regnskab og CRM ud' });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByRole('table', { name: 'Flows' })).toContainText(
    'Ordrer → Dinero Fakturaer',
  );
  await row.getByRole('button', { name: /Flere handlinger for/ }).click();
  await page.getByRole('menuitem', { name: 'Åbn editor' }).click();
  // The first visit compiles the editor in dev.
  await expect(page).toHaveURL(new RegExp(`/integrations/${WEBSHOP}/editor`), { timeout: 60_000 });

  // 5. Select the route on the canvas.
  await page.getByRole('button', { name: 'Vælg ruten Ordrer → Dinero Fakturaer' }).click();
  await expect(page.getByRole('complementary', { name: 'Rutens indstillinger' })).toContainText(
    'Ordrer → Dinero Fakturaer',
  );

  // 6. Validation finds the stale EU B2B account.
  await page.getByRole('button', { name: 'Validér' }).click();
  const findings = page.getByRole('region', { name: 'Validering og test' });
  await expect(findings).toContainText('Konto 1010 findes ikke i Dinero');
  await findings.getByRole('button', { name: 'Gå til feltet' }).first().click();
  const euB2b = page.locator('[id="field-mapping.accounts.euB2b"]');
  await expect(euB2b).toBeFocused();
  await expect(page.getByText('Kontoen 1010 findes ikke længere i Dinero.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('1-validation.png') });
  await axe(page);

  // 7. Choose 1015.
  await euB2b.click();
  await page.getByRole('option', { name: /1015/ }).click();
  await expect(euB2b).toContainText('1015');
  await page.getByRole('button', { name: 'Validér' }).click();
  await expect(findings).not.toContainText('Konto 1010 findes ikke i Dinero');

  // 8. Test run: the latest 10 orders, 9 would be created, the 0 kr order is skipped.
  await page.getByRole('button', { name: 'Testkør', exact: true }).click();
  await expect(findings).toContainText('De seneste 10 poster fra', { timeout: 20_000 });
  await expect(findings.getByText('Ville oprette', { exact: true }).locator('..')).toContainText(
    '9',
  );
  await expect(findings.getByText('Springes over', { exact: true }).locator('..')).toContainText(
    '1',
  );
  await expect(findings).not.toContainText('ville fejle');
  await page.screenshot({ path: test.info().outputPath('2-test-run.png') });

  // 9. Publish as draft, without booking.
  await page.getByRole('button', { name: 'Publicér', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Publicér version 8');
  await dialog.getByRole('radio', { name: /Som kladde, uden bogføring/ }).click();
  await dialog.getByRole('checkbox', { name: /Kør de 3 fejlede poster igen/ }).isChecked();
  await dialog.getByRole('checkbox', { name: /Jeg forstår, at flowet skriver til Dinero/ }).click();
  await page.screenshot({ path: test.info().outputPath('3-publish.png') });
  await axe(page);
  await dialog.getByRole('button', { name: 'Publicér som kladde' }).click();
  await expect(page.getByText('Version 8 er publiceret')).toBeVisible();

  // 10. The retry run resolves the three EU orders: Overblik is back to "Alt kører".
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Alt kører' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await axe(page);
});

test('a reader sees the editor read-only', async ({ page }) => {
  await login(page, 'bo');
  await page.goto(`/integrations/${WEBSHOP}/editor`);
  await expect(
    page.getByText('Du kan se flowet, men ikke redigere det med din rolle.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicér', exact: true })).toHaveCount(0);
});

test('a second editor sees the flow locked while someone edits it', async ({ page, browser }) => {
  await login(page, 'mette');
  await page.goto(`/integrations/${WEBSHOP}/editor`);
  await expect(page.getByRole('button', { name: 'Validér' })).toBeVisible({ timeout: 30_000 });
  const other = await browser.newPage();
  await login(other, 'jonas');
  await other.goto(`/integrations/${WEBSHOP}/editor`);
  await expect(
    other.getByText('Mette Holm redigerer flowet lige nu. Du ser det i læsetilstand.'),
  ).toBeVisible();
  await expect(other.getByRole('button', { name: 'Publicér', exact: true })).toHaveCount(0);
  await other.close();
});

test('the flow panel explains the flow, and ] hides the inspector', async ({ page }) => {
  await login(page, 'mette');
  await page.goto(`/integrations/${WEBSHOP}/editor`);
  const inspector = page.getByRole('complementary', { name: 'Rutens indstillinger' });
  await expect(inspector.getByRole('heading', { name: 'Hvad flowet gør' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(inspector).toContainText('ordrer fra WooCommerce bliver til fakturaer i Dinero.');
  await page.locator('.react-flow__pane').click();
  await page.keyboard.press(']');
  await expect(inspector).toHaveCount(0);
  await page.getByRole('button', { name: 'Vis indstillinger (])' }).click();
  await expect(inspector).toBeVisible();
  await axe(page);
});

test('an earlier version can be restored as the draft', async ({ page }) => {
  await login(page, 'mette');
  await page.goto(`/integrations/${WEBSHOP}?tab=settings`);
  await page.getByRole('button', { name: 'Gendan version 6 som kladde' }).click();
  await expect(page).toHaveURL(new RegExp(`/integrations/${WEBSHOP}/editor`), { timeout: 30_000 });
  await expect(page.getByText(/ændring(er)? i kladden/)).toBeVisible();
});

test('template picker creates a flow in Test and opens the editor (D4)', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/integrations/new');
  await expect(page.getByRole('heading', { name: 'Nyt flow' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Webshop til regnskab/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({ path: test.info().outputPath('picker.png') });
  await axe(page);
  await page.getByRole('radio', { name: /Kunder til CRM/ }).click();
  await page.getByLabel('Navn på flowet').fill('Kunder til HubSpot (e2e)');
  await page.getByRole('button', { name: 'Brug skabelon' }).click();
  await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]+\/editor\?guide=1/);
  await expect(page.getByText('Sådan kommer du i gang')).toBeVisible();
  await expect(page.getByText('Aldrig publiceret')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('guide.png') });
});
