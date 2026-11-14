import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { latestMailTo } from './mailpit';
import { login, USERS } from './support';

/**
 * PLAN-MOBILE M1: the mobile shell and components (README decision 20, MA/MP boards at 390 × 844)
 * in the projects mobile-390, mobile-360 and mobile-430.
 */
test.describe('@mobile component sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/mobile');
    await expect(page.getByRole('heading', { name: 'Mobilkomponenter', level: 1 })).toBeVisible();
  });

  test('no horizontal scroll and no WCAG 2.2 AA violations', async ({ page }, info) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
    await page.screenshot({
      path: `../../docs/screenshots/mobile/M1-dev-mobile-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('every control has a touch target of at least 44 × 44 px', async ({ page }) => {
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'main a[href], main button, main input, main [role="switch"]',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const after = getComputedStyle(el, '::after');
        const w = Math.max(r.width, after.content !== 'none' ? parseFloat(after.width) || 0 : 0);
        const h = Math.max(r.height, after.content !== 'none' ? parseFloat(after.height) || 0 : 0);
        if (w < 44 - 0.5 || h < 44 - 0.5)
          out.push(
            `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30) ?? ''}" ${Math.round(w)}×${Math.round(h)}`,
          );
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('sizes match the boards', async ({ page }) => {
    const box = async (sel: ReturnType<Page['locator']>) => (await sel.boundingBox())!;
    const shell = page.getByTestId('shell');
    // Top bar 60; MobileTabBar v3 (MX1/MX2): a 56 px pill, the active tab a 40 px pill with label.
    const bar = shell.locator('header').first();
    expect((await box(bar)).height).toBe(60);
    const bg = (l: ReturnType<Page['locator']>) =>
      l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const tabs = shell.getByRole('navigation', { name: 'Hovedmenu' });
    expect((await box(tabs)).height).toBe(56);
    const active = tabs.locator('[aria-current="page"]');
    expect((await box(active)).height).toBe(40);
    expect(await bg(active)).toBe('rgb(243, 241, 236)');
    const navy = shell.getByRole('navigation', { name: 'Platformmenu', exact: true });
    expect(await bg(navy)).toBe('rgb(19, 41, 58)');
    expect(await bg(navy.locator('[aria-current="page"]'))).toBe('rgba(255, 255, 255, 0.1)');
    // Rows are at least 56, BigButtons 52.
    const row = page.getByTestId('rows').getByRole('link', { name: /Webshop → regnskab og CRM/ });
    expect((await box(row)).height).toBeGreaterThanOrEqual(56);
    expect((await box(page.getByRole('button', { name: 'Gentag 3 ordrer' }).first())).height).toBe(
      52,
    );
    // SectionHeading: 12/700 uppercase fg-1, 14 px top margin.
    const heading = page.getByRole('heading', { name: 'Seneste aktivitet' });
    expect(
      await heading.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.fontWeight, s.textTransform, s.color, s.marginTop];
      }),
    ).toEqual(['12px', '700', 'uppercase', 'rgb(26, 26, 24)', '14px']);
    // The bell's badge is red when something is broken.
    const badge = shell.getByRole('link', { name: 'Notifikationer, 2 nye' }).locator('span').last();
    expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(180, 35, 24)',
    );
  });

  test('modal: centred, radius 20, focus trapped, Esc and backdrop close it', async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Åbn Registrér tid' });
    // Opened from the keyboard, so focus has somewhere to return to.
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Registrér tid' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('20px');
    const b = (await dialog.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.abs(b.x + b.width / 2 - vp.width / 2)).toBeLessThan(1);
    // Focus stays inside.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    // A tap on the backdrop closes it too.
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(vp.width / 2, 6);
    await expect(dialog).toBeHidden();
  });

  test('chips and switches toggle', async ({ page }) => {
    const chip = page.getByRole('button', { name: 'Problemer 2' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const sw = page.getByRole('switch', { name: 'Ugens opsummering' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('@mobile responsive switch', () => {
  test('one layout at a time at 767 and 768 px, focus never reaches the hidden one', async ({
    page,
  }) => {
    await login(page, 'mette');
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto('/settings/company');
    const tabs = page.getByRole('navigation', { name: 'Hovedmenu' });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Åbn på computer' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primær navigation' })).toBeHidden();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        // <nextjs-portal> is the dev overlay, not part of the app.
        if (!el || el === document.body || el.tagName === 'NEXTJS-PORTAL') return true;
        const r = el.getBoundingClientRect();
        // The skip link is visually hidden until focused; everything else must be on screen.
        return r.width > 0 && r.height > 0 && el.closest('[data-view="desktop"]') === null;
      });
      expect(visible).toBe(true);
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(tabs).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Primær navigation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Åbn på computer' })).toBeHidden();
  });

  test('desktop-only page sends a link to the computer', async ({ page }, info) => {
    await login(page, 'mette');
    await page.goto('/settings/company');
    await expect(page.getByText('Virksomhedsoplysninger og din profil ændres')).toBeVisible();
    const started = Date.now();
    await page.getByRole('button', { name: 'Send link til min computer' }).click();
    await expect(page.getByText(`Link sendt til ${USERS.mette.email}`)).toBeVisible();
    const mail = await latestMailTo(USERS.mette.email);
    expect(mail.subject).toMatch(/^Link til /);
    expect(mail.text).toContain('/settings/company');
    expect(Date.now() - started).toBeLessThan(15_000);
    await page.screenshot({
      path: `../../docs/screenshots/mobile/M1-desk-only-${info.project.name}.png`,
    });
  });

  test('Platform tabs per role, Profil last (README decisions 24 and 25)', async ({ page }) => {
    await login(page, 'kasper');
    await page.goto('/platform/customers');
    const tabs = page.getByRole('navigation', { name: 'Hovedmenu' });
    await expect(tabs.getByRole('link')).toHaveCount(5);
    for (const [i, name] of ['Kunder', 'Support', 'Finans', 'Admin', 'Profil'].entries())
      await expect(tabs.getByRole('link').nth(i)).toHaveAccessibleName(name);
    await expect(tabs.getByRole('link', { name: 'Kunder' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.context().clearCookies();
    await login(page, 'anne');
    await page.goto('/platform/customers');
    await expect(tabs.getByRole('link')).toHaveCount(3);
    for (const [i, name] of ['Kunder', 'Support', 'Profil'].entries())
      await expect(tabs.getByRole('link').nth(i)).toHaveAccessibleName(name);
    // And the routes themselves don't exist for a Supporter (same server check as desktop).
    const res = await page.goto('/platform/admin/reports/revenue');
    expect(res?.status()).toBe(404);
  });
});

/**
 * MobileTabBar v3 (PLAN-2026-10-21 M4, MX1/MX2): floating, the active tab with its label and
 * aria-current, the others an icon with an aria-label in a 44 × 44 target, Profil last, and out of
 * the way while typing.
 */
test.describe('@mobile tab bar v3', () => {
  const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Hovedmenu' });

  async function checkTabs(page: Page, names: string[], active: string) {
    const links = tabBar(page).getByRole('link');
    await expect(links).toHaveCount(names.length);
    for (const [i, name] of names.entries()) {
      const link = links.nth(i);
      await expect(link).toHaveAccessibleName(name);
      if (name === active) {
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect(link).toHaveText(name);
      } else {
        await expect(link).not.toHaveAttribute('aria-current');
        await expect(link).toHaveAttribute('aria-label', name);
        await expect(link).toHaveText('');
        const b = (await link.boundingBox())!;
        expect([b.width, b.height]).toEqual([44, 44]);
      }
    }
    // Floating: 14 px from the sides, at least 14 px above the bottom, 56 px high.
    const nav = (await tabBar(page).boundingBox())!;
    const vp = page.viewportSize()!;
    expect(nav.height).toBe(56);
    expect(nav.x).toBeGreaterThanOrEqual(14);
    expect(vp.height - (nav.y + nav.height)).toBeGreaterThanOrEqual(14);
  }

  test('customer app: five tabs with Profil last', async ({ page }) => {
    await login(page, 'mette');
    await page.goto('/integrations');
    const names = ['Overblik', 'Integrationer', 'Aktivitet', 'Mere', 'Profil'];
    await checkTabs(page, names, 'Integrationer');
    await tabBar(page).getByRole('link', { name: 'Profil' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await checkTabs(page, names, 'Profil');
    // Mere's profile card opens the profile too (MA10 → MA36).
    await page.goto('/more');
    await page.getByRole('link', { name: /Mette Holm/ }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('Platform: Superadmin and Supporter, with the section tabs', async ({ page }) => {
    await login(page, 'kasper');
    await page.goto('/platform/finance');
    await checkTabs(page, ['Kunder', 'Support', 'Finans', 'Admin', 'Profil'], 'Finans');
    const sub = page.getByRole('navigation', { name: 'Finans', exact: true });
    await expect(sub.getByRole('link', { name: 'Oversigt' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await sub.getByRole('link', { name: 'Fakturering' }).click();
    await expect(page).toHaveURL(/\/platform\/finance\/invoicing$/);
    await expect(
      page.getByRole('navigation', { name: 'Finans', exact: true }).getByRole('link', {
        name: 'Fakturering',
      }),
    ).toHaveAttribute('aria-current', 'page');
    await page.goto('/platform/admin/status');
    await checkTabs(page, ['Kunder', 'Support', 'Finans', 'Admin', 'Profil'], 'Admin');
    await page.context().clearCookies();
    await login(page, 'anne');
    await page.goto('/platform/support/access');
    await checkTabs(page, ['Kunder', 'Support', 'Profil'], 'Support');
    await expect(
      page.getByRole('navigation', { name: 'Support', exact: true }).getByRole('link'),
    ).toHaveText(['Sager', 'Adgange', 'Fejl', 'Tidsforbrug']);
  });

  test('hidden while a text field has focus', async ({ page }) => {
    await login(page, 'kasper');
    await page.goto('/platform/customers');
    await expect(tabBar(page)).toBeVisible();
    await page.getByRole('searchbox', { name: 'Søg kunde' }).focus();
    await expect(tabBar(page)).toBeHidden();
    await page.getByRole('searchbox', { name: 'Søg kunde' }).blur();
    await expect(tabBar(page)).toBeVisible();
  });
});

/**
 * Issue 2 (20 Oct 2026): every screen below 768 px has one top bar with the logo (or a back link
 * on detail screens) and the bell with its badge; navy on Platform.
 */
test.describe('@mobile top bar on every screen', () => {
  // The app's top bars are sticky; desktop content may use <header> inside cards.
  const visibleBars = (page: Page) => page.locator('header.sticky:visible');

  test('customer app', async ({ page }) => {
    await login(page, 'mette');
    for (const path of [
      '/',
      '/integrations',
      '/activity',
      '/connections',
      '/billing',
      '/support',
      '/settings/team',
      '/integrations/templates',
    ]) {
      await page.goto(path);
      const bars = visibleBars(page);
      await expect(bars, path).toHaveCount(1);
      await expect(
        bars.getByRole('link', { name: /Agentor, gå til Overblik|Tilbage/ }),
        path,
      ).toBeVisible();
      await expect(bars.getByRole('link', { name: /^Notifikationer/ }), path).toBeVisible();
      expect((await bars.boundingBox())!.height, path).toBe(60);
    }
  });

  test('Platform, navy', async ({ page }) => {
    await login(page, 'kasper');
    for (const path of [
      '/platform/customers',
      '/platform/support/cases',
      '/platform/support/errors',
      '/platform/finance',
      '/platform/support/time',
    ]) {
      await page.goto(path);
      const bars = visibleBars(page);
      await expect(bars, path).toHaveCount(1);
      expect(await bars.evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe(
        'rgb(19, 41, 58)',
      );
      await expect(bars.getByRole('link', { name: /^Mine sager/ }), path).toBeVisible();
    }
  });
});
