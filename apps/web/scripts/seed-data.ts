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
} as const;

export const FLOWS = {
  webshop: { id: '0190b000-0000-7000-8000-000000000201', name: 'Webshop → regnskab og CRM' },
  outlet: { id: '0190b000-0000-7000-8000-000000000202', name: 'Outlet → regnskab' },
  lager: { id: '0190b000-0000-7000-8000-000000000203', name: 'Lager retur' },
  nyhedsbrev: { id: '0190b000-0000-7000-8000-000000000204', name: 'Kunder til nyhedsbrev' },
  b2b: { id: '0190b000-0000-7000-8000-000000000205', name: 'B2B-ordrer' },
  kreditnotaer: { id: '0190b000-0000-7000-8000-000000000206', name: 'Kreditnotaer' },
} as const;
