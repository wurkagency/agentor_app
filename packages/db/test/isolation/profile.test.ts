import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminUrl } from './env.js';
import { ID } from './fixtures.js';

/**
 * Profile dashboard (0050, 0051): each user reads and writes only their own profile and
 * achievements; an avatar is served to the user, colleagues and staff seeing staff, never across
 * companies; the customer figures need membership of the current company; the 2FA rule is only
 * ever about the caller. Each test runs in one transaction and rolls back.
 */

const STAFF = '0190a000-0000-7000-8000-0000000f0002';
const STAFF2 = '0190a000-0000-7000-8000-0000000f0003';
const KEY_A = `avatars/${ID.userAOwner}/${'a'.repeat(64)}.webp`;
const KEY_STAFF = `avatars/${STAFF2}/${'b'.repeat(64)}.webp`;
let c: pg.Client;

beforeAll(async () => {
  c = new pg.Client({ connectionString: adminUrl(inject('isolationDb')) });
  await c.connect();
});
afterAll(() => c.end());

type Step = {
  as: 'web' | 'admin';
  user?: string;
  tenant?: string;
  sql: string;
  values?: unknown[];
};

async function steps(list: Step[]) {
  const out: {
    rows?: Record<string, unknown>[];
    rowCount?: number | null;
    error?: pg.DatabaseError;
  }[] = [];
  await c.query('begin');
  try {
    for (const s of list) {
      await c.query('reset role');
      await c.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
        [s.tenant ?? '', s.user ?? ''],
      );
      if (s.as !== 'admin') await c.query('set local role agentor_web');
      await c.query('savepoint s');
      try {
        const r = await c.query(s.sql, s.values ?? []);
        out.push({ rows: r.rows, rowCount: r.rowCount });
      } catch (error) {
        await c.query('rollback to savepoint s');
        if (!(error instanceof pg.DatabaseError)) throw error;
        out.push({ error });
      }
    }
  } finally {
    await c.query('rollback');
  }
  return out;
}

const web = (user: string, sql: string, values?: unknown[], tenant?: string): Step => ({
  as: 'web',
  user,
  sql,
  ...(values ? { values } : {}),
  ...(tenant ? { tenant } : {}),
});
const seedAvatar: Step = {
  as: 'admin',
  sql: `insert into user_profiles (user_id, avatar_key) values ($1, $2)`,
  values: [ID.userAOwner, KEY_A],
};
/** Two staff users with accounts; the second has an avatar. */
const seedStaff: Step[] = [
  {
    as: 'admin',
    sql: `insert into auth.users (id, name, email, email_verified)
          values ($1, 'Staff One', 'staff1@e2e.agentor.test', true), ($2, 'Staff Two', 'staff2@e2e.agentor.test', true)`,
    values: [STAFF, STAFF2],
  },
  {
    as: 'admin',
    sql: `insert into platform.staff (user_id, role) values ($1, 'supporter'), ($2, 'supporter')`,
    values: [STAFF, STAFF2],
  },
  {
    as: 'admin',
    sql: `insert into user_profiles (user_id, avatar_key) values ($1, $2)`,
    values: [STAFF2, KEY_STAFF],
  },
];
const avatarOf = (viewer: string, target: string, tenant?: string) =>
  web(viewer, `select app.avatar_key_for($1) as key`, [target], tenant);

describe('own profile rows (user_profiles, user_achievements)', () => {
  it('a user writes and reads only their own profile', async () => {
    const r = await steps([
      web(ID.userAOwner, `insert into user_profiles (user_id, city) values ($1, 'Aarhus')`, [
        ID.userAOwner,
      ]),
      web(ID.userAOwner, `insert into user_profiles (user_id, city) values ($1, 'X')`, [
        ID.userBOwner,
      ]),
      web(ID.userBOwner, `select count(*)::int as n from user_profiles`),
      web(ID.userBOwner, `update user_profiles set city = 'X' where user_id = $1`, [ID.userAOwner]),
      web(ID.userAOwner, `select city from user_profiles`),
      web(ID.userAOwner, `delete from user_profiles where user_id = $1`, [ID.userAOwner]),
    ]);
    expect(r[0]!.error).toBeUndefined();
    expect(r[1]!.error?.code).toBe('42501');
    expect(r[2]!.rows![0]!.n).toBe(0);
    expect(r[3]!.rowCount).toBe(0);
    expect(r[4]!.rows).toEqual([{ city: 'Aarhus' }]);
    expect(r[5]!.error?.code).toBe('42501');
  });

  it("achievements are the user's own; definitions are read-only", async () => {
    const r = await steps([
      web(
        ID.userAOwner,
        `insert into user_achievements (user_id, key) values ($1, 'first_flow_live')`,
        [ID.userAOwner],
      ),
      web(
        ID.userAOwner,
        `insert into user_achievements (user_id, key) values ($1, 'first_flow_live')`,
        [ID.userBOwner],
      ),
      web(ID.userBOwner, `select count(*)::int as n from user_achievements`),
      web(ID.userAOwner, `update achievement_definitions set threshold = 1`),
      web(ID.userAOwner, `select count(*)::int as n from achievement_definitions`),
    ]);
    expect(r[0]!.error).toBeUndefined();
    expect(r[1]!.error?.code).toBe('42501');
    expect(r[2]!.rows![0]!.n).toBe(0);
    expect(r[3]!.error?.code).toBe('42501');
    expect(r[4]!.rows![0]!.n).toBe(12);
  });
});

describe('avatar_key_for: who may see an avatar', () => {
  it('the user and colleagues in a shared company, never another company', async () => {
    const r = await steps([
      seedAvatar,
      avatarOf(ID.userAOwner, ID.userAOwner),
      avatarOf(ID.userAReader, ID.userAOwner),
      avatarOf(ID.userShared, ID.userAOwner, ID.tenantB),
      avatarOf(ID.userBOwner, ID.userAOwner),
      avatarOf(ID.userBOwner, ID.userAOwner, ID.tenantA),
      web('', `select app.avatar_key_for($1) as key`, [ID.userAOwner]),
    ]);
    expect(r[1]!.rows![0]!.key).toBe(KEY_A);
    expect(r[2]!.rows![0]!.key).toBe(KEY_A);
    // A member of both companies sees it whichever company is active.
    expect(r[3]!.rows![0]!.key).toBe(KEY_A);
    expect(r[4]!.rows![0]!.key).toBeNull();
    // A claimed tenant context opens nothing.
    expect(r[5]!.rows![0]!.key).toBeNull();
    expect(r[6]!.rows![0]!.key).toBeNull();
  });

  it('staff see staff, but neither customers nor a support grant open a customer avatar', async () => {
    const r = await steps([
      seedAvatar,
      ...seedStaff,
      avatarOf(STAFF, STAFF2),
      avatarOf(ID.userAOwner, STAFF2),
      avatarOf(STAFF, ID.userAOwner, ID.tenantA),
    ]);
    expect(r[4]!.rows![0]!.key).toBe(KEY_STAFF);
    expect(r[5]!.rows![0]!.key).toBeNull();
    expect(r[6]!.rows![0]!.key).toBeNull();
  });

  it('leaves the caller and tenant context as they were', async () => {
    const r = await steps([
      seedAvatar,
      web(
        ID.userAReader,
        `select app.avatar_key_for($1) as key, current_setting('app.user_id') as u,
                current_setting('app.tenant_id') as t`,
        [ID.userAOwner],
        ID.tenantA,
      ),
    ]);
    expect(r[1]!.rows![0]).toEqual({ key: KEY_A, u: ID.userAReader, t: ID.tenantA });
  });
});

describe('profile_customer_stats', () => {
  it("needs membership of the current company and counts only that company's data", async () => {
    const stats = `select app.profile_customer_stats(now()) as s`;
    const r = await steps([
      web(ID.userAOwner, stats, undefined, ID.tenantA),
      web(ID.userBOwner, stats, undefined, ID.tenantA),
      web(ID.userAOwner, stats),
      web(ID.userShared, stats, undefined, ID.tenantB),
    ]);
    expect(r[0]!.error).toBeUndefined();
    expect(r[1]!.error?.message).toContain('NOT_MEMBER');
    expect(r[2]!.error?.message).toContain('NOT_MEMBER');
    const a = r[0]!.rows![0]!.s as Record<string, unknown>;
    const b = r[3]!.rows![0]!.s as Record<string, unknown>;
    const count = async (tenant: string) =>
      (
        await c.query<{ n: number }>(
          `select count(*)::int as n from memberships where tenant_id = $1`,
          [tenant],
        )
      ).rows[0]!.n;
    expect(a.members).toBe(await count(ID.tenantA));
    expect(b.members).toBe(await count(ID.tenantB));
  });
});

describe('must_keep_two_factor', () => {
  it('is about the caller only: staff, or a company that requires it for everyone', async () => {
    const must = `select app.must_keep_two_factor() as m`;
    const r = await steps([
      ...seedStaff,
      web(STAFF, must),
      web(ID.userAOwner, must),
      {
        as: 'admin',
        sql: `update tenants set require_mfa_all = true where id = $1`,
        values: [ID.tenantA],
      },
      web(ID.userAReader, must),
      web(ID.userBOwner, must),
      web('', must),
    ]);
    expect(r[3]!.rows![0]!.m).toBe(true);
    expect(r[4]!.rows![0]!.m).toBe(false);
    expect(r[6]!.rows![0]!.m).toBe(true);
    expect(r[7]!.rows![0]!.m).toBe(false);
    expect(r[8]!.rows![0]!.m).toBe(false);
  });
});
