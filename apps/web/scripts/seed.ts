/**
 * Seeds the local database with the Nordlys Cykler sample data (designspecifikation §10.1).
 * Idempotent: deletes and recreates the sample tenants and users.
 *
 *   pnpm --filter @agentor/web seed
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

const { symmetricEncrypt } = await import('better-auth/crypto');
const { billingPeriod, monthStart } = await import('@agentor/core');
const { auth } = await import('../src/server/auth/auth');
const {
  CONNECTIONS,
  FLOWS,
  SEED_PASSWORD,
  SEED_TOTP_SECRET,
  SEED_WOO_WEBHOOK_TOKEN,
  TENANTS,
  USERS,
} = await import('./seed-data');
const { publicKeyFromBase64, seal, secretBinding } = await import('@agentor/keybox');
const { hashWebhookToken } = await import('@agentor/db');
const { seedFlows } = await import('./seed-flows');
const { DINERO_ACCOUNTS } = await import('@agentor/connectors');
/** board (default): what the boards show; gate: the Phase 1 prototype path (scripts/seed-flows.ts). */
const SCENARIO = process.env.SEED_SCENARIO === 'gate' ? 'gate' : 'board';

const ownerUrl = process.env.DATABASE_URL_OWNER;
if (!ownerUrl) throw new Error('DATABASE_URL_OWNER missing');

// Tenant data is written as agentor_owner inside a tenant context, so RLS WITH CHECK applies.
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();

async function inTenant(tenantId: string, fn: () => Promise<void>) {
  await owner.query('begin');
  try {
    await owner.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await fn();
    await owner.query('commit');
  } catch (e) {
    await owner.query('rollback');
    throw e;
  }
}

// --- reset ---------------------------------------------------------------------------------
for (const t of Object.values(TENANTS)) {
  await inTenant(t.id, async () => {
    await owner.query('delete from tenants where id = $1', [t.id]);
  });
}

const ctx = await auth().$context;
for (const u of Object.values(USERS)) {
  const existing = await ctx.internalAdapter.findUserByEmail(u.email);
  if (existing) await ctx.internalAdapter.deleteUser(existing.user.id);
}
// Accounts made by e2e sign-up tests (…@e2e.agentor.test) and the companies they created.
{
  const adminUrl = new URL(process.env.DATABASE_ADMIN_URL ?? '');
  adminUrl.pathname = new URL(ownerUrl).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(
    `delete from tenants t where exists (select 1 from memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = t.id and m.role = 'owner' and u.email like '%@e2e.agentor.test')`,
  );
  await admin.query(`delete from auth.users where email like '%@e2e.agentor.test'`);
  await admin.end();
}

// --- identity (auth schema) ---------------------------------------------------------------------
const passwordHash = await ctx.password.hash(SEED_PASSWORD);
for (const u of Object.values(USERS)) {
  await ctx.adapter.create({
    model: 'user',
    data: {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: true,
      twoFactorEnabled: u.mfa,
      locale: 'da',
    },
    forceAllowId: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: u.id,
    providerId: 'credential',
    accountId: u.id,
    password: passwordHash,
  });
  if (u.mfa) {
    await ctx.adapter.create({
      model: 'twoFactor',
      data: {
        userId: u.id,
        secret: await symmetricEncrypt({ key: ctx.secretConfig, data: SEED_TOTP_SECRET }),
        backupCodes: await symmetricEncrypt({
          key: ctx.secretConfig,
          data: JSON.stringify(Array.from({ length: 8 }, (_, i) => `seed${i}-backup`)),
        }),
        verified: true,
      },
    });
  }
}

// --- tenants, memberships, flows -------------------------------------------------------------------
const n = TENANTS.nordlys;
await inTenant(n.id, async () => {
  await owner.query(
    `insert into tenants (id, name, cvr, address_line, postal_code, city, billing_email, orders_per_month, onboarding_completed_at, first_test_run_at)
     values ($1, $2, $3, 'Cykelvej 12', '8000', 'Aarhus C', 'regnskab@nordlys-cykler.dk', '200-1000', '2026-08-01T09:00:00+02:00', '2026-08-01T10:12:00+02:00')`,
    [n.id, n.name, n.cvr],
  );
  const m = async (userId: string, role: string, scope = 'all', external = false) =>
    (
      await owner.query<{ id: string }>(
        `insert into memberships (tenant_id, user_id, role, flow_scope, is_external) values ($1, $2, $3, $4, $5) returning id`,
        [n.id, userId, role, scope, external],
      )
    ).rows[0]!.id;
  await m(USERS.mette.id, 'owner');
  await m(USERS.jonas.id, 'admin');
  // Sara (freelance developer) and Bo (accountant) are external: tagged "Ekstern", no seat.
  const sara = await m(USERS.sara.id, 'developer', 'selected', true);
  await m(USERS.bo.id, 'reader', 'all', true);
  for (const f of Object.values(FLOWS)) {
    await owner.query(`insert into flows (tenant_id, id, name) values ($1, $2, $3)`, [
      n.id,
      f.id,
      f.name,
    ]);
  }
  // Abonnement (D13): Business, Visa •••• 4242, renews 1. of next month, 712 of 1.000 used.
  const period = billingPeriod(new Date());
  const [y, mo] = period.split('-').map(Number) as [number, number];
  const month = (offset: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + offset, 1));
    return monthStart(d.getUTCFullYear(), d.getUTCMonth() + 1);
  };
  const periodStart = month(0);
  const periodEnd = month(1);
  await owner.query(
    `insert into subscriptions (tenant_id, plan_id, status, provider_subscription_id, card_brand, card_last4, card_expiry, current_period_start, current_period_end)
     values ($1, 'business', 'active', 'mock_AGSEEDNORDLYS', 'visa', '4242', '08/28', $2, $3)`,
    [n.id, periodStart, periodEnd],
  );
  await owner.query(
    `insert into usage_counters (tenant_id, period, transactions) values ($1, $2, 712)`,
    [n.id, period],
  );
  for (const [i, num] of ['AG-2026-1043', 'AG-2026-0912', 'AG-2026-0788'].entries()) {
    // Charged in advance: the newest invoice is for the current period (D13: "1. okt.").
    const start = month(-i);
    const end = month(1 - i);
    await owner.query(
      `insert into invoices (tenant_id, number, period_start, period_end, description, amount_ore, vat_ore, status, paid_at)
       values ($1, $2, $3, $4, 'Business · månedlig', 15900, 3975, 'paid', $3)`,
      [n.id, num, start, end],
    );
  }
  // Forbindelser (D9): credentials sealed to the KEK exactly as the app does it.
  const kekPub = process.env.KEK_PUBLIC_KEY;
  if (!kekPub) throw new Error('KEK_PUBLIC_KEY missing (node infra/scripts/dev-kek.mjs)');
  for (const c of Object.values(CONNECTIONS)) {
    const broken = c.connectorId === 'economic';
    await owner.query(
      `insert into connections (tenant_id, id, connector_id, name, status, status_reason, broken_since, account_id,
         configured_by, configured_by_name, last_checked_at, last_webhook_at, token_expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Mette Holm', now() - interval '2 minutes', $10, $11, '2026-09-02T10:00:00+02:00')`,
      [
        n.id,
        c.id,
        c.connectorId,
        c.name,
        broken ? 'broken' : 'ok',
        broken ? 'Adgangen blev trukket tilbage i e-conomic.' : null,
        broken ? new Date(Date.now() - 27 * 3600_000) : null,
        c.accountId,
        USERS.mette.id,
        c.connectorId === 'woocommerce' ? new Date(Date.now() - 60_000) : null,
        c.connectorId === 'dinero' ? '2027-01-14T00:00:00+01:00' : null,
      ],
    );
    const creds =
      broken || c.connectorId !== 'economic' ? c.credentials : { grantToken: 'seed-economic' };
    const env = seal(JSON.stringify(creds), publicKeyFromBase64(kekPub), secretBinding(n.id, c.id));
    await owner.query(
      `insert into connection_secrets (tenant_id, connection_id, format, nonce, ciphertext) values ($1, $2, $3, $4, $5)`,
      [n.id, c.id, env.format, env.nonce, env.ciphertext],
    );
  }
  // The chart of accounts as the worker caches it after a connection test (D3 lookups).
  for (const id of [CONNECTIONS.dinero.id, CONNECTIONS.economic.id])
    await owner.query(
      `insert into connection_lookups (tenant_id, connection_id, list, options) values ($1, $2, 'accounts', $3)`,
      [n.id, id, JSON.stringify(DINERO_ACCOUNTS)],
    );
  await owner.query(
    `insert into app.webhook_routes (token_hash, tenant_id, connection_id) values ($1, $2, $3)`,
    [hashWebhookToken(SEED_WOO_WEBHOOK_TOKEN), n.id, CONNECTIONS.woo.id],
  );

  // Flows, versions and run history (D1, D2, D7, D8, D10).
  await seedFlows(owner, n.id, SCENARIO);

  // Sara Lind: external developer with access to one flow until 12. nov. 2026.
  await owner.query(
    `insert into flow_grants (tenant_id, membership_id, flow_id, expires_at) values ($1, $2, $3, '2026-11-12T23:59:59+01:00')`,
    [n.id, sara, FLOWS.webshop.id],
  );
});

const o = TENANTS.outlet;
await inTenant(o.id, async () => {
  await owner.query(
    `insert into tenants (id, name, cvr, address_line, postal_code, city, onboarding_completed_at)
     values ($1, $2, $3, 'Havnegade 3', '5000', 'Odense C', '2026-09-15T09:00:00+02:00')`,
    [o.id, o.name, o.cvr],
  );
  await owner.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [
    o.id,
    USERS.mette.id,
  ]);
  await owner.query(
    `insert into subscriptions (tenant_id, plan_id, status, provider_subscription_id, card_brand, card_last4, card_expiry, current_period_start, current_period_end)
     values ($1, 'startup', 'active', 'mock_AGSEEDOUTLET', 'mastercard', '5100', '11/27', now() - interval '10 days', now() + interval '20 days')`,
    [o.id],
  );
  await owner.query(
    `insert into usage_counters (tenant_id, period, transactions) values ($1, $2, 41)`,
    [o.id, billingPeriod(new Date())],
  );
});

// Seeded invoice numbers sit below the sequence, so new invoices never collide with them.
await owner.query(
  `select setval('app.invoice_number_seq', greatest(2000, (select last_value from app.invoice_number_seq)))`,
);

await owner.end();
console.log(
  `Seeded ${Object.keys(USERS).length} users, ${Object.keys(TENANTS).length} tenants, ${Object.keys(FLOWS).length} flows.`,
);
process.exit(0);
