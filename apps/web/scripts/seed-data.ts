/**
 * Fictional sample data (designspecifikation §10.1). Development and test only: the seed
 * refuses to run with NODE_ENV=production, and these credentials exist nowhere else.
 */

/** Password for every seeded user (local development and e2e tests only). */
export const SEED_PASSWORD = 'Nordlys-demo-2026!';

/**
 * TOTP secret for seeded owners/admins, so e2e tests can compute codes. Better Auth stores it
 * encrypted with BETTER_AUTH_SECRET like any other secret.
 */
export const SEED_TOTP_SECRET = 'nordlys-dev-totp-secret-000000001';

export const TENANTS = {
  nordlys: {
    id: '0190b000-0000-7000-8000-000000000001',
    name: 'Nordlys Cykler ApS',
    cvr: '12345678',
  },
  outlet: {
    id: '0190b000-0000-7000-8000-000000000002',
    name: 'Nordlys Outlet ApS',
    cvr: '87654321',
  },
} as const;

export const USERS = {
  mette: {
    id: '0190b000-0000-7000-8000-000000000101',
    name: 'Mette Holm',
    email: 'mette@nordlys-cykler.dk',
    mfa: true,
  },
  jonas: {
    id: '0190b000-0000-7000-8000-000000000102',
    name: 'Jonas Krag',
    email: 'jonas@nordlys-cykler.dk',
    mfa: true,
  },
  sara: {
    id: '0190b000-0000-7000-8000-000000000103',
    name: 'Sara Lind',
    email: 'sara@lind-dev.dk',
    mfa: false,
  },
  bo: {
    id: '0190b000-0000-7000-8000-000000000104',
    name: 'Bo Dahl',
    email: 'bo@dahl-revision.dk',
    mfa: false,
  },
  // Agentor Platform staff (P6). A .test domain, so nothing can ever be mailed to them.
  kasper: {
    id: '0190b000-0000-7000-8000-000000000111',
    name: 'Kasper Nyborg',
    email: 'kasper@agentor.test',
    mfa: true,
  },
  anne: {
    id: '0190b000-0000-7000-8000-000000000112',
    name: 'Anne Sørensen',
    email: 'anne@agentor.test',
    mfa: true,
  },
  line: {
    id: '0190b000-0000-7000-8000-000000000113',
    name: 'Line Ravn',
    email: 'line@agentor.test',
    mfa: true,
  },
  mads: {
    id: '0190b000-0000-7000-8000-000000000114',
    name: 'Mads Brink',
    email: 'mads@agentor.test',
    mfa: true,
  },
} as const;

/**
 * SEED_SCENARIO=signup (PLAN-SIGNUP S4): three self-service owners, one per signup state. A .test
 * domain, so no code or receipt can be mailed. The two unpaid ones are purged 24 h after seeding (B1).
 */
export const SIGNUP_USERS = {
  // Verified e-mail, no company yet: opens on SU3.
  konto: {
    id: '0190b000-0000-7000-8000-000000000121',
    name: 'Freja Kragh',
    email: 'freja@nordlys-cykler.test',
    mfa: false,
  },
  // Company and plan chosen, terms not accepted, not paid: opens on SU5.
  betaling: {
    id: '0190b000-0000-7000-8000-000000000122',
    name: 'Emil Vang',
    email: 'emil@nordlys-cykler.test',
    mfa: false,
  },
  // Paid and active, skipped onboarding at OB1: Overblik with the reminder.
  onboarding: {
    id: '0190b000-0000-7000-8000-000000000123',
    name: 'Nora Bech',
    email: 'nora@nordlys-cykler.test',
    mfa: true,
  },
} as const;

/** Further fictional customers for the Platform's customer list (P1). */
export const PLATFORM_TENANTS = {
  molle: {
    id: '0190b000-0000-7000-8000-000000000003',
    name: 'Mølle Sport ApS',
    cvr: '23456789',
    plan: 'startup',
    flows: 2,
  },
  hav: {
    id: '0190b000-0000-7000-8000-000000000004',
    name: 'Hav Hudpleje IVS',
    cvr: '34567890',
    plan: 'business',
    flows: 3,
  },
  bjerg: {
    id: '0190b000-0000-7000-8000-000000000005',
    name: 'Bjerg & Søn Byg A/S',
    cvr: '45678901',
    plan: 'enterprise',
    flows: 11,
  },
  kvist: {
    id: '0190b000-0000-7000-8000-000000000006',
    name: 'Kvist Møbler A/S',
    cvr: '56789012',
    plan: 'business',
    flows: 4,
  },
  fjord: {
    id: '0190b000-0000-7000-8000-000000000007',
    name: 'Fjordkaffe ApS',
    cvr: '67890123',
    plan: 'startup',
    flows: 1,
  },
  osterbro: {
    id: '0190b000-0000-7000-8000-000000000008',
    name: 'Østerbro Vin ApS',
    cvr: '78901234',
    plan: 'business',
    flows: 2,
  },
  lyngby: {
    id: '0190b000-0000-7000-8000-000000000009',
    name: 'Lyngby Legetøj ApS',
    cvr: '89012345',
    plan: 'startup',
    flows: 1,
  },
} as const;

export const FLOWS = {
  webshop: { id: '0190b000-0000-7000-8000-000000000201', name: 'Webshop → regnskab og CRM' },
  outlet: { id: '0190b000-0000-7000-8000-000000000202', name: 'Outlet → regnskab' },
  lager: { id: '0190b000-0000-7000-8000-000000000203', name: 'Lager retur' },
  nyhedsbrev: { id: '0190b000-0000-7000-8000-000000000204', name: 'Kunder til nyhedsbrev' },
  b2b: { id: '0190b000-0000-7000-8000-000000000205', name: 'B2B-ordrer' },
  kreditnotaer: { id: '0190b000-0000-7000-8000-000000000206', name: 'Kreditnotaer' },
} as const;

/** The six connections on D9-Forbindelser; e-conomic is broken (token expired yesterday). */
export const CONNECTIONS = {
  woo: {
    id: '0190b000-0000-7000-8000-000000000301',
    connectorId: 'woocommerce',
    name: 'nordlys-cykler.dk',
    accountId: 'nordlys-cykler.dk',
    credentials: {
      baseUrl: 'https://nordlys-cykler.dk',
      consumerKey: 'ck_seed_nordlys',
      consumerSecret: 'cs_seed_nordlys',
    },
  },
  shopify: {
    id: '0190b000-0000-7000-8000-000000000302',
    connectorId: 'shopify',
    name: 'Nordlys Outlet',
    accountId: 'nordlys-outlet',
    credentials: { accessToken: 'mock-seed-shopify' },
  },
  dinero: {
    id: '0190b000-0000-7000-8000-000000000303',
    connectorId: 'dinero',
    name: 'Nordlys Cykler',
    accountId: '412983',
    credentials: { accessToken: 'mock-seed-dinero' },
  },
  economic: {
    id: '0190b000-0000-7000-8000-000000000304',
    connectorId: 'economic',
    name: 'Nordlys Outlet',
    accountId: '771204',
    credentials: { grantToken: 'revoked-seed-economic' },
  },
  hubspot: {
    id: '0190b000-0000-7000-8000-000000000305',
    connectorId: 'hubspot',
    name: 'Nordlys Cykler',
    accountId: '24015566',
    credentials: { accessToken: 'mock-seed-hubspot' },
  },
  brevo: {
    id: '0190b000-0000-7000-8000-000000000306',
    connectorId: 'brevo',
    name: 'Nyhedsbrev',
    accountId: 'nyhedsbrev',
    credentials: { apiKey: 'xkeysib-seed-nordlys' },
  },
} as const;

/** Webhook token for the seeded WooCommerce connection (e2e posts webhooks with it). */
export const SEED_WOO_WEBHOOK_TOKEN = 'nordlys-seed-woocommerce-webhook-token-0001';
