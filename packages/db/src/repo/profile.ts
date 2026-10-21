import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { withTenant, withoutTenant, type Database, type Transaction } from '../client.js';

type Ctx = { tenantId: string; userId: string };
import {
  achievementDefinitions,
  authAccounts,
  authPasskeys,
  authSessions,
  authUsers,
  userAchievements,
  userProfiles,
  type AchievementAudience,
} from '../schema/index.js';

/**
 * Profile dashboard (README decision 25, PR1/D15/MP29/MA36). Every function works on the signed-in
 * user only: the profile row and achievements are RLS-scoped to app.current_user_id(), and the
 * figures come from tables that already exist. Nothing new is tracked.
 */

const asUser = <T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>) =>
  withoutTenant(db, fn, userId);

export interface Profile {
  userId: string;
  name: string;
  email: string;
  locale: 'da' | 'en';
  twoFactorEnabled: boolean;
  createdAt: Date;
  givenName: string;
  familyName: string;
  phone: string;
  timeZone: string;
  title: string;
  city: string;
  avatarKey: string | null;
  avatarUpdatedAt: Date | null;
}

/** Splits "Anne Sørensen" when the profile row doesn't exist yet. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? [parts.slice(0, -1).join(' '), parts.at(-1)!] : [parts[0] ?? '', ''];
}

export async function getProfile(db: Database, userId: string): Promise<Profile> {
  return asUser(db, userId, async (tx) => {
    const [u] = await tx
      .select({
        name: authUsers.name,
        email: authUsers.email,
        locale: authUsers.locale,
        twoFactorEnabled: authUsers.twoFactorEnabled,
        createdAt: authUsers.createdAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    if (!u) throw new Error('USER_NOT_FOUND');
    const [p] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    const [given, family] = splitName(u.name);
    return {
      userId,
      name: u.name,
      email: u.email,
      locale: (u.locale as 'da' | 'en' | null) ?? 'da',
      twoFactorEnabled: u.twoFactorEnabled ?? false,
      createdAt: u.createdAt,
      givenName: p?.givenName || given,
      familyName: p?.familyName || family,
      phone: p?.phone ?? '',
      timeZone: p?.timeZone ?? 'Europe/Copenhagen',
      title: p?.title ?? '',
      city: p?.city ?? '',
      avatarKey: p?.avatarKey ?? null,
      avatarUpdatedAt: p?.avatarUpdatedAt ?? null,
    };
  });
}

export interface ProfileInput {
  givenName: string;
  familyName: string;
  phone: string;
  timeZone: string;
  city: string;
  /** Staff only; ignored for customers. */
  title?: string | undefined;
  locale: 'da' | 'en';
}

/** Saves the user's own details; the display name on auth.users follows the two name fields. */
export async function saveProfile(
  db: Database,
  userId: string,
  input: ProfileInput,
): Promise<{ before: Partial<ProfileInput>; after: ProfileInput }> {
  return asUser(db, userId, async (tx) => {
    const [p] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    const [u] = await tx
      .select({ locale: authUsers.locale })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    const values = {
      givenName: input.givenName.trim(),
      familyName: input.familyName.trim(),
      phone: input.phone.trim(),
      timeZone: input.timeZone,
      city: input.city.trim(),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      updatedAt: new Date(),
    };
    await tx
      .insert(userProfiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: userProfiles.userId, set: values });
    await tx
      .update(authUsers)
      .set({
        name: `${values.givenName} ${values.familyName}`.trim(),
        locale: input.locale,
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, userId));
    return {
      before: p
        ? {
            givenName: p.givenName,
            familyName: p.familyName,
            phone: p.phone,
            timeZone: p.timeZone,
            city: p.city,
            title: p.title,
            locale: (u?.locale as 'da' | 'en' | null) ?? 'da',
          }
        : {},
      after: input,
    };
  });
}

/** Sets or clears the avatar key; returns the previous key so the old file can be deleted. */
export async function setAvatarKey(
  db: Database,
  userId: string,
  key: string | null,
): Promise<string | null> {
  return asUser(db, userId, async (tx) => {
    const [p] = await tx
      .select({ key: userProfiles.avatarKey })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    const now = new Date();
    await tx
      .insert(userProfiles)
      .values({ userId, avatarKey: key, avatarUpdatedAt: now })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { avatarKey: key, avatarUpdatedAt: now, updatedAt: now },
      });
    return p?.key ?? null;
  });
}

/** The avatar key of `targetId` if `viewerId` may see it (app.avatar_key_for, 0051). */
export async function avatarKeyFor(
  db: Database,
  viewerId: string,
  targetId: string,
): Promise<string | null> {
  const res = await asUser(db, viewerId, (tx) =>
    tx.execute<{ key: string | null }>(sql`select app.avatar_key_for(${targetId}::uuid) as key`),
  );
  return res.rows[0]?.key ?? null;
}

/** Whether these users have a photo (for the initials fallback in lists). */
export async function avatarsFor(
  db: Database,
  viewerId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const res = await asUser(db, viewerId, (tx) =>
    tx.execute<{ id: string; key: string | null }>(
      sql`select u.id, app.avatar_key_for(u.id) as key from unnest(${userIds}::uuid[]) as u(id)`,
    ),
  );
  return new Set(res.rows.filter((r) => r.key).map((r) => r.id));
}

/* ---- Achievements --------------------------------------------------------------------------- */

export interface AchievementDefinition {
  key: string;
  audience: AchievementAudience;
  icon: string;
  metric: string;
  threshold: number;
  windowDays: number | null;
}

export async function achievementDefinitionsFor(
  db: Database,
  userId: string,
  audience: AchievementAudience,
): Promise<AchievementDefinition[]> {
  return asUser(db, userId, (tx) =>
    tx
      .select({
        key: achievementDefinitions.key,
        audience: achievementDefinitions.audience,
        icon: achievementDefinitions.icon,
        metric: achievementDefinitions.metric,
        threshold: achievementDefinitions.threshold,
        windowDays: achievementDefinitions.windowDays,
      })
      .from(achievementDefinitions)
      .where(
        and(
          eq(achievementDefinitions.audience, audience),
          eq(achievementDefinitions.enabled, true),
        ),
      )
      .orderBy(asc(achievementDefinitions.sortOrder)),
  );
}

/** Records newly reached achievements (idempotent) and returns when each was earned. */
export async function recordAchievements(
  db: Database,
  userId: string,
  reached: string[],
): Promise<Map<string, Date>> {
  return asUser(db, userId, async (tx) => {
    if (reached.length)
      await tx
        .insert(userAchievements)
        .values(reached.map((key) => ({ userId, key })))
        .onConflictDoNothing();
    const rows = await tx
      .select({ key: userAchievements.key, earnedAt: userAchievements.earnedAt })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return new Map(rows.map((r) => [r.key, r.earnedAt]));
  });
}

/* ---- Sessions ------------------------------------------------------------------------------- */

/** The newest sign-in other than this one ("Sidst logget ind"), from the session rows. */
export async function previousSignIn(
  db: Database,
  userId: string,
  currentSessionId: string,
): Promise<{ at: Date; userAgent: string | null } | null> {
  const rows = await db
    .select({ id: authSessions.id, createdAt: authSessions.createdAt, ua: authSessions.userAgent })
    .from(authSessions)
    .where(eq(authSessions.userId, userId))
    .orderBy(desc(authSessions.createdAt))
    .limit(5);
  const r = rows.find((x) => x.id !== currentSessionId);
  return r ? { at: r.createdAt, userAgent: r.ua } : null;
}

/* ---- Staff figures (PR1, MP29) -------------------------------------------------------------- */

export interface StaffProfileStats {
  /** Times this staff member set a case to resolved. */
  resolvedAt: Date[];
  /** Minutes from a customer's message to this staff member's first reply after it. */
  replies: { at: Date; minutes: number }[];
  /** Colleagues whose cases this staff member answered or noted on. */
  colleaguesHelped: number;
  /** Support sessions started (start times) and the share of time logged automatically. */
  sessions: Date[];
  minutesThisMonth: number;
  autoShare: number;
  /** "Hos Agentor siden": when the staff row was made. */
  staffSince: Date | null;
}

export async function staffProfileStats(
  db: Database,
  userId: string,
  since: Date,
  monthStart: string,
): Promise<StaffProfileStats> {
  return asUser(db, userId, async (tx) => {
    const resolved = await tx.execute<{ at: Date }>(sql`
      select e.created_at as at from platform.case_events e
       where e.kind = 'status' and e.author_user_id = ${userId} and e.meta->>'to' = 'resolved'
       order by e.created_at`);
    const replies = await tx.execute<{ at: Date; minutes: number }>(sql`
      select r.created_at as at,
             extract(epoch from (r.created_at - m.created_at)) / 60 as minutes
        from platform.case_events m
        join lateral (
          select e.created_at from platform.case_events e
           where e.case_id = m.case_id and e.kind = 'reply' and e.created_at > m.created_at
           order by e.created_at limit 1
        ) first on true
        join platform.case_events r on r.case_id = m.case_id and r.created_at = first.created_at
       where m.kind = 'customer_message' and r.author_user_id = ${userId} and m.created_at >= ${since}`);
    const [helped] = (
      await tx.execute<{ n: number }>(sql`
        select count(distinct c.assignee_id)::int as n from platform.case_events e
          join platform.cases c on c.id = e.case_id
         where e.author_user_id = ${userId} and e.kind in ('reply', 'internal_note')
           and c.assignee_id is not null and c.assignee_id <> ${userId}`)
    ).rows;
    const sessions = await tx.execute<{ at: Date }>(sql`
      select s.started_at as at from platform.support_sessions s
       where s.staff_user_id = ${userId} and s.started_at >= ${since}`);
    const [time] = (
      await tx.execute<{ total: number; auto: number }>(sql`
        select coalesce(sum(t.minutes), 0)::int as total,
               coalesce(sum(t.minutes) filter (where t.source = 'auto'), 0)::int as auto
          from platform.time_entries t
         where t.staff_user_id = ${userId} and t.work_date >= ${monthStart}::date`)
    ).rows;
    const [staffRow] = (
      await tx.execute<{ at: Date }>(
        sql`select s.created_at as at from platform.staff s where s.user_id = ${userId}`,
      )
    ).rows;
    return {
      staffSince: staffRow ? new Date(staffRow.at) : null,
      resolvedAt: resolved.rows.map((r) => new Date(r.at)),
      replies: replies.rows.map((r) => ({ at: new Date(r.at), minutes: Number(r.minutes) })),
      colleaguesHelped: Number(helped?.n ?? 0),
      sessions: sessions.rows.map((r) => new Date(r.at)),
      minutesThisMonth: Number(time?.total ?? 0),
      autoShare:
        time && Number(time.total) > 0
          ? Math.round((Number(time.auto) / Number(time.total)) * 100)
          : 0,
    };
  });
}

/* ---- Customer figures (D15, MA36) ----------------------------------------------------------- */

export interface CustomerProfileStats {
  records7d: number;
  recordsTotal: number;
  runs30: number;
  runsOk30: number;
  flowsLive: number;
  firstLiveFlow: string | null;
  flowsCreated: number;
  draftFlows: number;
  invitationsSent: number;
  maxRecordsDay: number;
  errorsFixed: number;
  fixedWithinHour: number;
  failedDays: string[];
  firstRunDay: string | null;
  members: number;
  membersTwoFactor: number;
  connectionBreaks: Date[];
  brokenNow: number;
  tenantCreatedAt: Date;
  memberSince: Date | null;
  activity: Record<string, number>;
}

export async function customerProfileStats(
  db: Database,
  ctx: Ctx,
  now: Date,
): Promise<CustomerProfileStats> {
  const res = await withTenant(db, ctx, (tx) =>
    tx.execute<{ s: Record<string, unknown> }>(sql`select app.profile_customer_stats(${now}) as s`),
  );
  const s = res.rows[0]!.s;
  const n = (k: string) => Number(s[k] ?? 0);
  return {
    records7d: n('records7d'),
    recordsTotal: n('recordsTotal'),
    runs30: n('runs30'),
    runsOk30: n('runsOk30'),
    flowsLive: n('flowsLive'),
    firstLiveFlow: (s.firstLiveFlow as string | null) ?? null,
    flowsCreated: n('flowsCreated'),
    draftFlows: n('draftFlows'),
    invitationsSent: n('invitationsSent'),
    maxRecordsDay: n('maxRecordsDay'),
    errorsFixed: n('errorsFixed'),
    fixedWithinHour: n('fixedWithinHour'),
    failedDays: (s.failedDays as string[]) ?? [],
    firstRunDay: (s.firstRunDay as string | null) ?? null,
    members: n('members'),
    membersTwoFactor: n('membersTwoFactor'),
    connectionBreaks: ((s.connectionBreaks as string[]) ?? []).map((d) => new Date(d)),
    brokenNow: n('brokenNow'),
    tenantCreatedAt: new Date(s.tenantCreatedAt as string),
    memberSince: s.memberSince ? new Date(s.memberSince as string) : null,
    activity: Object.fromEntries(
      Object.entries((s.activity as Record<string, number>) ?? {}).map(([k, v]) => [k, Number(v)]),
    ),
  };
}

/* ---- Login og sikkerhed --------------------------------------------------------------------- */

export interface SecurityOverview {
  hasPassword: boolean;
  /** When the password row last changed (set or changed); Better Auth keeps no other date. */
  passwordChangedAt: Date | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  passkeys: { id: string; name: string | null; createdAt: Date | null }[];
}

export async function securityOverview(db: Database, userId: string): Promise<SecurityOverview> {
  const [u] = await db
    .select({ verified: authUsers.emailVerified, tfa: authUsers.twoFactorEnabled })
    .from(authUsers)
    .where(eq(authUsers.id, userId));
  const [acc] = await db
    .select({ updatedAt: authAccounts.updatedAt, password: authAccounts.password })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'credential')));
  const keys = await db
    .select({ id: authPasskeys.id, name: authPasskeys.name, createdAt: authPasskeys.createdAt })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId))
    .orderBy(asc(authPasskeys.createdAt));
  return {
    hasPassword: Boolean(acc?.password),
    passwordChangedAt: acc?.password ? acc.updatedAt : null,
    emailVerified: u?.verified ?? false,
    twoFactorEnabled: u?.tfa ?? false,
    passkeys: keys,
  };
}

/**
 * Whether the user must keep two-step login on: every Agentor staff member, and anyone in a
 * company that requires it for everyone (D12 "Kræv totrin for alle").
 */
export async function mustKeepTwoFactor(db: Database, userId: string): Promise<boolean> {
  const res = await asUser(db, userId, (tx) =>
    tx.execute<{ must: boolean }>(sql`select app.must_keep_two_factor() as must`),
  );
  return Boolean(res.rows[0]?.must);
}
