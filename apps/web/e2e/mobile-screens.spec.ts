import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONNECTIONS, FLOWS, TENANTS } from '../scripts/seed-data';
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
  /** null: signed out (MA01). */
  user: keyof typeof USERS | null;
  path: string | ((page: Page) => Promise<string>);
  /** Texts the board shows that must be on screen. */
  texts: (string | RegExp)[];
  /** A step after loading, e.g. opening the modal the board shows (MP04). */
  then?: (page: Page) => Promise<void>;
}

/** The seeded EU-invoice case (MP03), from the case list (MP02). */
async function euCaseHref(page: Page) {
  await page.goto('/platform/cases');
  const link = page
    .getByRole('link', { name: /Fakturaer til EU-kunder fejler/ })
    .filter({ visible: true });
  const href = await link.first().getAttribute('href');
  if (!href) throw new Error('no EU case on MP02');
  return href;
}

async function supportViewHref(page: Page) {
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Åbn kundens app' }).filter({ visible: true }).click();
  await page.waitForURL((u) => u.pathname === '/');
  return '/';
}

/** MP20: Nordlys Cykler's Kundeøkonomi, found from F2 (the link is the same on both branches). */
async function customerFinanceHref(page: Page) {
  await page.goto('/platform/finance/subscriptions?q=nordlys');
  const href = await page
    .locator('[data-view="mobile"] a[href^="/platform/finance/customers/"]')
    .first()
    .getAttribute('href');
  if (!href) throw new Error('no customer on MP18');
  return href;
}

/** MP21: the first support draft of the month, from "Se faktura" on MP19. */
async function supportInvoiceHref(page: Page) {
  await page.goto('/platform/finance/support');
  const href = await page
    .locator('[data-view="mobile"] a[href^="/platform/finance/support/"]')
    .first()
    .getAttribute('href');
  if (!href) throw new Error('no customer with support on MP19');
  return href;
}

const SCREENS: Screen[] = [
  {
    board: 'MA03-Overblik-Problemer',
    user: 'mette',
    path: '/',
    texts: [
      /God ?(morgen|dag|aften), Mette/,
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
  {
    board: 'MA07-Aktivitet',
    user: 'mette',
    path: '/activity',
    texts: ['Aktivitet', 'Alle', /^Fejl \d+$/, 'Flow', 'I dag'],
  },
  {
    board: 'MA08-Genforbind',
    user: 'mette',
    path: `/connections/${CONNECTIONS.economic.id}/reconnect`,
    texts: ['e-conomic er afbrudt', 'Sendes, så snart forbindelsen virker igen', 'Senere'],
  },
  {
    board: 'MA09-Notifikationer',
    user: 'mette',
    path: '/notifications',
    texts: ['Notifikationer', 'Marker alle læst', 'Vælg hvad du får besked om'],
  },
  {
    board: 'MA10-Mere',
    user: 'mette',
    path: '/more',
    texts: [
      'Mette Holm',
      'Abonnement og forbrug',
      'Supportadgang',
      'Notifikationer',
      'Sikkerhed',
      'Kontakt support',
      'Log ud',
    ],
  },
  {
    board: 'MA11-Notifikationsindstillinger',
    user: 'mette',
    path: '/settings/notifications',
    texts: [
      'Push på denne telefon',
      'Fejl i et flow',
      'Ugens opsummering',
      'Ingen push om natten',
      /22\.00–07\.00/,
    ],
  },
  {
    board: 'MA13-Installer',
    user: 'mette',
    path: '/install',
    texts: ['Agentor på hjemmeskærmen', 'Tryk på Del', 'Jeg har gjort det'],
  },
  {
    board: 'MA15-Abonnement',
    user: 'mette',
    path: '/billing',
    texts: [
      /^Business · (årlig|månedlig)$/,
      /^Transaktioner i /,
      /^Support i /,
      'Betalingskort',
      'Skift plan',
    ],
  },
  {
    board: 'MA01-Log-ind',
    user: null,
    path: '/login',
    texts: [
      'Log ind med passkey',
      'Log ind med e-mail og kode',
      /Face ID, Touch ID eller fingeraftryk/,
    ],
  },
  {
    board: 'MP01-Kunder',
    user: 'anne',
    path: '/platform/customers',
    texts: ['Platform', /^Alle \d+$/, /^Kræver opmærksomhed \d+$/, 'Nordlys Cykler ApS'],
  },
  {
    board: 'MP02-Sager',
    user: 'anne',
    path: '/platform/cases',
    texts: [
      'Sager',
      /^Din tid i dag /,
      /^Mine \d+$/,
      /^Ikke tildelt \d+$/,
      /^Venter \d+$/,
      'Arkiv',
      'Fakturaer til EU-kunder fejler',
      'Ny sag',
    ],
  },
  {
    board: 'MP03-Sag',
    user: 'anne',
    path: euCaseHref,
    texts: [
      /^#\d+ · Fakturaer til EU-kunder fejler$/,
      'I gang',
      'Høj',
      /Fakturaer til EU-kunder fejler siden i morges/,
      'Svar kunden',
      'Intern note',
      /^\d{2}:\d{2}:\d{2} på sagen$/,
    ],
  },
  {
    board: 'MP04-Tid',
    user: 'anne',
    path: euCaseHref,
    then: async (page) => {
      await page.getByRole('button', { name: 'Registrér tid' }).filter({ visible: true }).click();
    },
    texts: [
      'Vælg varighed',
      '15 min.',
      '30 min.',
      '1 time',
      'Telefon',
      'Fakturerbar tid',
      'Gem 15 min.',
    ],
  },
  {
    board: 'MP05-Fejl',
    user: 'anne',
    path: '/platform/errors',
    texts: [
      'Fejl',
      'Sidste 24 timer',
      'records fejlet',
      'kunder ramt',
      'uden sag',
      /aldrig kundedata/,
    ],
  },
  {
    board: 'MP06-Finans',
    user: 'kasper',
    path: '/platform/finance',
    texts: [
      'Finans',
      'Mdl. abonnementsomsætning',
      'År til dato',
      'Kræver handling',
      'Supportafregning',
      'Fakturaer og betalinger',
    ],
  },
  {
    board: 'MP07-Forfaldne',
    user: 'kasper',
    path: '/platform/finance/invoices?status=overdue',
    texts: ['Forfaldne betalinger', /fakturaer? · .* inkl\. moms$/],
  },
  {
    board: 'MA17-Soeg',
    user: 'mette',
    path: '/search?q=10447',
    texts: ['Ordrer', '#10447 · Hans Weber GmbH'],
  },
  {
    board: 'MA17-Soeg-Tom',
    user: 'mette',
    path: '/search',
    texts: [
      'Flows og forbindelser',
      'Webshop → regnskab og CRM',
      'Skriv mindst 2 tegn for at søge i ordrer.',
    ],
  },
  {
    board: 'MA22-Testkoersel',
    user: 'mette',
    // Opening the screen starts the test run of the draft on top of v7; texts wait for the worker.
    path: `/integrations/${FLOWS.webshop.id}/test`,
    texts: [
      'Prøve · intet er skrevet',
      'Ville oprettes',
      'Springes over',
      'Ruter',
      'Kør igen',
      'Publicér v8',
    ],
  },
  {
    board: 'MA23-Publicer',
    user: 'mette',
    path: `/integrations/${FLOWS.webshop.id}/publish`,
    texts: [
      'Publicér v8',
      'Sådan oprettes fakturaer i Dinero',
      'Som kladde, uden bogføring',
      'Bogfør med det samme (Live)',
      'Publicér som kladde',
    ],
  },
  {
    board: 'MA26-Forbindelser',
    user: 'mette',
    path: '/connections',
    texts: [
      'Forbindelser',
      '6 forbindelser · 1 afbrudt',
      'e-conomic',
      'Afbrudt',
      'Genautentificér',
      'Adgangsnøgler er krypteret og vises aldrig igen.',
    ],
  },
  {
    board: 'MA27-Tilfoej-forbindelse',
    user: 'mette',
    path: '/connections/new',
    texts: [
      'Tilføj forbindelse',
      'Alle 7',
      'Regnskab',
      'Marketing',
      'Forbundet',
      'Mailchimp',
      'Forbind',
    ],
  },
  {
    board: 'MA28-Afstemning',
    user: 'mette',
    path: '/activity/reconciliation',
    texts: [
      'Afstemning',
      'Ordrer i webshoppen mod fakturaer i regnskabet',
      'Sidste 7 dage',
      '30 dage',
      /Ordrer i /,
      /Fakturaer i /,
    ],
  },
  {
    board: 'MA35-Notifikationskanaler',
    user: 'mette',
    path: '/settings/notifications/channels',
    texts: [
      'Notifikationer',
      'Forbindelse afbrudt',
      'Systematisk fejl',
      'Ugentlig opsummering',
      'E-mail',
      'SMS',
      'Tærskel og stilletid',
    ],
  },
  {
    board: 'MA29-Team',
    user: 'mette',
    path: '/settings/team',
    texts: [
      'Team og adgang',
      'Mette Holm',
      'Jonas Krag',
      'Sara Lind',
      'Bo Dahl',
      'Agentor support',
      'Invitér',
    ],
  },
  {
    board: 'MA30-Inviter',
    user: 'mette',
    path: '/settings/team',
    texts: ['Invitér bruger', 'Udvalgte flows', 'Adgangen udløber', 'Send invitation'],
    then: async (page) => {
      await page.getByRole('button', { name: 'Invitér' }).filter({ visible: true }).click();
      await page.getByRole('dialog', { name: 'Invitér bruger' }).waitFor();
    },
  },
  {
    board: 'MA31-Sikkerhed',
    user: 'mette',
    path: '/settings/security',
    texts: [
      'Totrin for mig',
      'Kræv totrin for hele teamet',
      'Passkeys',
      'Aktive sessioner',
      'Kræv godkendelse',
    ],
  },
  {
    board: 'MA32-Auditlog',
    user: 'mette',
    path: '/settings/audit-log',
    texts: ['Audit-log', 'Alle', 'Kun supportadgang'],
  },
  {
    board: 'MA33-Skift-plan',
    user: 'mette',
    path: '/billing/plan',
    texts: [
      'Skift plan',
      'Månedligt',
      'Årligt · 2 md. gratis',
      'Enterprise',
      'Business',
      'Startup',
      'Din plan',
    ],
  },
  {
    board: 'MA34-MFA',
    user: null,
    path: '/login/mfa',
    texts: ['Bekræft, at det er dig', 'Husk denne enhed i 30 dage', 'Brug en reservekode'],
  },
  {
    board: 'MP08-Kunde',
    user: 'anne',
    path: `/platform/customers/${TENANTS.nordlys.id}`,
    texts: [
      'Nordlys Cykler ApS',
      /^Du har supportadgang til /,
      /tilbage · godkendt af Jonas/,
      'Åbn kundens app',
      'Afslut adgang',
      'Oversigt',
      /^Flows \d+$/,
      /^Sager \d+$/,
      'Kræver handling',
      'Kunde og kontakt',
      /^Mette Holm · ejer$/,
      'Adgangslog',
      'Godkendte supportadgang',
    ],
  },
  {
    board: 'MP09-Anmod-adgang',
    user: 'line',
    // `?request=1` opens the sheet, as "Anmod" in MP11 does.
    // Outlet: Line has no grant there (the push flow gives her one on Nordlys).
    path: `/platform/customers/${TENANTS.outlet.id}?request=1`,
    texts: [
      'Anmod om supportadgang',
      /^Nordlys Outlet ApS · CVR \d{8}$/,
      'Sag',
      'Begrundelse til kunden',
      'Varighed',
      '8 timer',
      'Omfang',
      'Kun se',
      'Se og hjælpe',
      'Send anmodning',
    ],
  },
  {
    board: 'MP10-Supportvisning',
    user: 'anne',
    path: supportViewHref,
    texts: [
      'Supportvisning · Nordlys Cykler ApS',
      /^Se og hjælpe · sag #\d+ · \d+ t tilbage$/,
      'Afslut',
      /kræver handling/,
    ],
  },
  {
    board: 'MP11-Skift-kunde',
    user: 'anne',
    path: supportViewHref,
    then: async (page) => {
      await page.getByRole('button', { name: 'Skift kunde' }).filter({ visible: true }).click();
    },
    texts: [
      'Aktive adgange',
      'Nordlys Cykler ApS',
      'Seneste',
      'Mølle Sport ApS',
      'Afventer',
      /Uden adgang åbnes kundesiden i Platform/,
    ],
  },
  {
    board: 'MP14-Afslut-session',
    user: 'anne',
    path: supportViewHref,
    then: async (page) => {
      await page
        .getByRole('button', { name: 'Afslut supportvisning' })
        .filter({ visible: true })
        .click();
    },
    texts: [
      'Afslut supportsession',
      /^Nordlys Cykler ApS · i dag \d{2}[.:]\d{2}–\d{2}[.:]\d{2}$/,
      /i sessionen$/,
      'Knyt til sag',
      'Kort opsummering · intern note',
      'Fakturerbar tid',
      /^Gem .+ på #\d+$/,
      'Fortsæt session',
      'Kassér tid',
    ],
  },
  {
    board: 'MP17-Kunde-handlinger',
    user: 'anne',
    path: `/platform/customers/${TENANTS.nordlys.id}`,
    then: async (page) => {
      await page
        .getByRole('button', { name: 'Handlinger for Nordlys Cykler ApS' })
        .filter({ visible: true })
        .click();
    },
    texts: [
      'Åbn som support',
      /^Adgang til /,
      'Ny sag',
      'Knyttes til kunden',
      'Bed om forlængelse',
      'Afslut supportadgang',
      'Logges i kundens audit-log',
    ],
  },
  {
    board: 'MP12-Platformbrugere',
    user: 'kasper',
    path: '/platform/users',
    texts: [
      'Platformbrugere',
      /^\d+ medarbejdere$/,
      'Kun Superadmin kan se og ændre denne side',
      'Kasper Nyborg',
      'Anne Sørensen',
      'Line Ravn',
      'Mads Brink',
      'Aktive kundeadgange',
      'Skift rolle',
      'Deaktivér',
      'Rettigheder pr. rolle',
      'Regler for supportadgang',
      'Maks. 24 timer · sag og begrundelse kræves',
    ],
  },
  {
    board: 'MP13-Sager-Arkiv',
    user: 'anne',
    path: '/platform/cases/archive',
    texts: [
      'Arkiv',
      /^\d+ (løst sag|løste og lukkede sager)$/,
      'Kategori',
      'Supporter',
      'Løsning',
      'Åbn sag',
      /^Viser \d+ af \d+ sager · i alt /,
    ],
  },
  {
    board: 'MP15-Min-tid',
    user: 'anne',
    path: '/platform/time',
    texts: [
      'Min tid',
      /^Uge \d+ · /,
      'Din tid i dag',
      'Denne uge',
      /Ugemål 30 t/,
      /^I alt \d+:\d{2}$/,
      'Fakturaer til EU-kunder fejler',
      'Kunder oprettes dobbelt i Dinero',
      'Teammøde og vidensdeling',
      'Registrér tid',
    ],
  },
  {
    board: 'MP16-Loes-sag',
    user: 'anne',
    path: async (page) => `${await euCaseHref(page)}/resolve`,
    texts: [
      'Løs sag',
      /^Sag #\d+$/,
      'Forhåndsvis',
      'Modtagere',
      'Mette Holm',
      'Med i forløbet',
      'Beskeder',
      'Opsummering af sessioner',
      'Tidsforbrug',
      'Interne noter',
      'Sendes aldrig til kunden',
      'Afsluttende besked',
      'Sagens status bagefter',
      'Løs uden at sende',
      'Løs og send',
    ],
  },
  {
    board: 'MP18-Abonnementer',
    user: 'kasper',
    path: '/platform/finance/subscriptions',
    texts: [
      'Abonnementer',
      'Årlig abn. oms.',
      'Prøveperioder',
      'Churn',
      /^Alle \d+$/,
      /^Betalingsproblemer \d+$/,
      /opsagt på 30 dage$/,
    ],
  },
  {
    board: 'MP19-Supportafregning',
    user: 'kasper',
    path: '/platform/finance/support',
    texts: [
      'Supportafregning',
      /kr\.\/t inkl\. moms$/,
      /^Perioden lukkes /,
      'Til afregning',
      'Registreret tid',
      'Kunder med support',
      'Faktureringsgrad',
      'Tid uden sag og tid markeret som ikke fakturerbar kommer ikke med.',
    ],
  },
  {
    board: 'MP20-Kunde-oekonomi',
    user: 'kasper',
    path: async (page) => customerFinanceHref(page),
    texts: [
      'Kundens økonomi',
      'Omsætning i år',
      /^Support i /,
      /^Abonnement · /,
      'Fakturaer · inkl. moms',
    ],
  },
  {
    board: 'MP21-Supportfaktura',
    user: 'kasper',
    path: async (page) => supportInvoiceHref(page),
    texts: [
      'Supportfaktura',
      /i kørslen/,
      'Subtotal ekskl. moms',
      'Moms 25 %',
      'I alt inkl. moms',
      'Afsendelse',
      'Vis oprunding pr. linje',
      /^(Godkend|Godkendt|Opret kladde)$/,
    ],
  },
  {
    board: 'MP22-Betalinger',
    user: 'kasper',
    path: '/platform/finance/payments',
    texts: [
      'Fakturaer og betalinger',
      'Beløb inkl. moms',
      /^Faktureret i /,
      'Forfaldent',
      /^Næste kørsel /,
      /^Kræver handling \d+$/,
      'Seneste betalinger',
    ],
  },
  {
    board: 'MP23-Rapporter',
    user: 'kasper',
    path: '/platform/finance/reports',
    texts: [
      'Rapporter',
      'Pr. måned',
      'Omsætning i alt',
      'Send til bogholder',
      'Største kunder i support',
      'Tid pr. supporter',
    ],
  },
  // SCREENS-END
];

test.describe('@mobile boards', () => {
  for (const s of SCREENS)
    test(s.board, async ({ page }, info) => {
      if (s.user) await login(page, s.user);
      const path = typeof s.path === 'string' ? s.path : await s.path(page);
      await page.goto(path);
      if (s.then) await s.then(page);
      for (const text of s.texts)
        await expect(
          page.getByText(text).filter({ visible: true }).first(),
          `${s.board}: ${String(text)}`,
        ).toBeVisible();
      await checkScreen(page, s.board, info.project.name);
    });
});
