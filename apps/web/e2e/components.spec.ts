import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * M1 acceptance: the component sheet (apps/web/src/app/dev/components) against
 * docs/design/runde-1/boards/Komponenter-*.dc.html.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/dev/components');
  await expect(page.getByRole('heading', { name: 'Komponenter', level: 1 })).toBeVisible();
});

test('has no WCAG 2.2 AA violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});

test('focus ring is 2 px #1A1A18 with 2 px offset', async ({ page }) => {
  const button = page.getByTestId('btn-primary-l');
  await button.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.outlineWidth,
      style: s.outlineStyle,
      color: s.outlineColor,
      offset: s.outlineOffset,
    };
  });
  expect(style).toEqual({ width: '2px', style: 'solid', color: 'rgb(26, 26, 24)', offset: '2px' });
});

test('primary hover uses lime bright, secondary hover uses bg-base', async ({ page }) => {
  const primary = page.getByTestId('btn-primary-m');
  const secondary = page.getByTestId('btn-secondary-m');
  const bg = (l: typeof primary) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(primary)).toBe('rgb(208, 232, 74)');
  await primary.hover();
  await expect.poll(() => bg(primary)).toBe('rgb(220, 238, 85)');
  await secondary.hover();
  await expect.poll(() => bg(secondary)).toBe('rgb(240, 237, 232)');
});

test('primary CTA L is 48 px, 12/700 uppercase with +0.10em tracking', async ({ page }) => {
  const s = await page.getByTestId('btn-primary-l').evaluate((el) => {
    const c = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      size: c.fontSize,
      weight: c.fontWeight,
      transform: c.textTransform,
      tracking: c.letterSpacing,
      radius: c.borderTopLeftRadius,
    };
  });
  expect(s).toMatchObject({
    height: 48,
    size: '12px',
    weight: '700',
    transform: 'uppercase',
    tracking: '1.2px',
  });
  expect(parseFloat(s.radius)).toBeGreaterThan(24);
});

test('every status pill shows an icon and text, never colour alone', async ({ page }) => {
  const pills = page.getByTestId('sheet-status').locator('[data-status]');
  const count = await pills.count();
  expect(count).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < count; i++) {
    const pill = pills.nth(i);
    await expect(pill).toHaveText(/\S/);
    expect(await pill.locator('svg, span[aria-hidden]').count()).toBeGreaterThan(0);
  }
});

test('loading buttons announce busy state', async ({ page }) => {
  // One loading example per button variant on the sheet.
  await expect(page.locator('button[aria-busy="true"]')).toHaveCount(6);
});

test('destructive dialog only confirms after typing the exact name', async ({ page }) => {
  await page.getByTestId('sheet-feedback').getByRole('button', { name: 'Slet flow' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Slet flow' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Skriv flowets navn for at bekræfte').fill('Lager retu');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Skriv flowets navn for at bekræfte').fill('Lager retur');
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('combobox searches the chart of accounts and marks missing accounts', async ({ page }) => {
  await page.getByRole('combobox', { name: /EU B2B-salg/ }).click();
  await page.getByPlaceholder('Søg i kontoplanen').fill('1015');
  await page.getByRole('option', { name: /1015/ }).click();
  await expect(page.getByRole('combobox', { name: /EU B2B-salg/ })).toContainText('1015');
});

test('respects prefers-reduced-motion', async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/dev/components');
  const duration = await page
    .locator('button[aria-busy="true"] svg')
    .first()
    .evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await context.close();
});

test.describe('visual @visual', () => {
  for (const id of [
    'button',
    'status',
    'mode',
    'logo',
    'pair',
    'stat',
    'chips',
    'controls',
    'inputs',
    'table',
    'feedback',
    'states',
  ]) {
    test(`sheet section ${id}`, async ({ page }) => {
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId(`sheet-${id}`)).toHaveScreenshot(`${id}.png`);
    });
  }
});
