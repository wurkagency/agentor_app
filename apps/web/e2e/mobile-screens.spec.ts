import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FLOWS } from '../scripts/seed-data';
import { login, type USERS } from './support';

/** The failure screen (MA06) of the seeded EU-account error, via the flow screen (MA05). */
async function failureHref(page: Page) {
  await page.goto(`/integrations/${FLOWS.webshop.id}`);
  const link = page.getByRole('link', { name: /^Gentag \d+ fejlede$/ }).filter({ visible: true });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('no failure link on MA05');
  return href;
}

/**
 * PLAN-MOBILE M2/M4: one test per mobile board (docs/design/runde-1/boards/MA*, MP*) against the
 * seeded Nordlys Cykler data, in the projects mobile-390 and mobile-360. Each screen: the board's
 * key texts, no horizontal scroll, no WCAG 2.2 AA violations, and a screenshot next to the board
 * in docs/screenshots/mobile/.
 */

export async function checkScreen(page: Page, board: string, project: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `${board}: horizontal scroll`,
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The dev overlay is not part of the app.
    .exclude('nextjs-portal')
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `${board}: axe`,
  ).toEqual([]);
  await page.screenshot({
    path: `../../docs/screenshots/mobile/${board}-${project}.png`,
    // The viewport, like the 390 × 844 boards; the fixed bars stay where they belong.
    fullPage: false,
  });
}

interface Screen {
  board: string;
  user: keyof typeof USERS;
  path: string | ((page: Page) => Promise<string>);
  /** Texts the board shows that must be on screen. */
  texts: (string | RegExp)[];
}

const SCREENS: Screen[] = [
  {
    board: 'MA03-Overblik-Problemer',
    user: 'mette',
    path: '/',
    texts: [
      /God (morgen|dag|aften), Mette/,
      /kræver handling/,
      'Records i dag',
      'Transaktioner',
      'Flows',
    ],
  },
  {
    board: 'MA04-Integrationer',
    user: 'mette',
    path: '/integrations',
    texts: [
      'Integrationer',
      /^Alle \d+$/,
      /^Problemer \d+$/,
      'Webshop → regnskab og CRM',
      /Nye flows og mapping laves på computer/,
    ],
  },
  {
    board: 'MA19-Flows-Tabel',
    user: 'mette',
    path: '/integrations?select=1',
    texts: ['Tryk for at folde ud', 'Records 7 dage', 'Se kørsler', 'Færdig'],
  },
  {
    board: 'MA05-Flow',
    user: 'mette',
    path: `/integrations/${FLOWS.webshop.id}`,
    texts: ['Sidst kørt', 'Records i dag', /^Gentag \d+ fejlede$/, 'Pausér flow', 'Ruter'],
  },
  {
    board: 'MA20-Flow-Ruter',
    user: 'mette',
    path: `/integrations/${FLOWS.webshop.id}?tab=routes`,
    texts: [/^Ruter · \d+$/, /^Kilde: WooCommerce/, /^Publiceret v\d+/],
  },
  {
    board: 'MA24-Koersler',
    user: 'mette',
    path: `/integrations/${FLOWS.webshop.id}/runs`,
    texts: ['Kørsler', 'I dag', 'Kun fejl', '7 dage'],
  },
  {
    board: 'MA06-Fejl',
    user: 'mette',
    path: async (page) => failureHref(page),
    texts: [
      'Hvorfor',
      'Sådan løser du det',
      /bogføres i Dinero$/,
      'Send link til min computer',
      /^Gentag \d+ ordrer?$/,
    ],
  },
  {
    board: 'MA25-Koersel-Udvikler',
    user: 'mette',
    path: async (page) => `${await failureHref(page)}?view=developer`,
    texts: ['Basic', 'Developer', 'Fejlet', 'ACCOUNT_NOT_FOUND'],
  },
  // SCREENS-END
];

test.describe('@mobile boards', () => {
  for (const s of SCREENS)
    test(s.board, async ({ page }, info) => {
      await login(page, s.user);
      const path = typeof s.path === 'string' ? s.path : await s.path(page);
      await page.goto(path);
      for (const text of s.texts)
        await expect(
          page.getByText(text).filter({ visible: true }).first(),
          `${s.board}: ${String(text)}`,
        ).toBeVisible();
      await checkScreen(page, s.board, info.project.name);
    });
});
