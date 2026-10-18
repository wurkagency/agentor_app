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
const { auth } = await import('../src/server/auth/auth');
const { FLOWS, SEED_PASSWORD, SEED_TOTP_SECRET, TENANTS, USERS } = await import('./seed-data');

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
  await owner.query(`insert into tenants (id, name, cvr) values ($1, $2, $3)`, [
    n.id,
    n.name,
    n.cvr,
  ]);
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
  // Sara Lind: external developer with access to one flow until 12. nov. 2026.
  await owner.query(
    `insert into flow_grants (tenant_id, membership_id, flow_id, expires_at) values ($1, $2, $3, '2026-11-12T23:59:59+01:00')`,
    [n.id, sara, FLOWS.webshop.id],
  );
});

const o = TENANTS.outlet;
await inTenant(o.id, async () => {
  await owner.query(`insert into tenants (id, name, cvr) values ($1, $2, $3)`, [
    o.id,
    o.name,
    o.cvr,
  ]);
  await owner.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [
    o.id,
    USERS.mette.id,
  ]);
});

await owner.end();
console.log(
  `Seeded ${Object.keys(USERS).length} users, ${Object.keys(TENANTS).length} tenants, ${Object.keys(FLOWS).length} flows.`,
);
process.exit(0);
