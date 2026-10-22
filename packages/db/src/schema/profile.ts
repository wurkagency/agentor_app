import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users as authUsers } from './auth.js';
import { updatedAt } from './columns.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Profile dashboard (README decision 25, PR1/D15): the personal details Better Auth's user row
 * has no room for, and the avatar's key in the storage area. Each user reads and writes only
 * their own row (RLS); name and avatar reach colleagues through auth.users and /api/avatar.
 */
export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    givenName: text('given_name').notNull().default(''),
    familyName: text('family_name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    timeZone: text('time_zone').notNull().default('Europe/Copenhagen'),
    /** Staff only (PR1 "Titel"); a customer's role comes from the membership. */
    title: text('title').notNull().default(''),
    /** Shown in the contact chips ("Dansk · Aarhus"); optional. */
    city: text('city').notNull().default(''),
    /** "avatars/<user id>/<sha256>.webp" in the storage area. */
    avatarKey: text('avatar_key'),
    avatarUpdatedAt: ts('avatar_updated_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('user_profiles_phone_check', sql`length(${t.phone}) <= 30`),
    check(
      'user_profiles_text_check',
      sql`length(${t.givenName}) <= 80 and length(${t.familyName}) <= 80 and length(${t.title}) <= 80 and length(${t.city}) <= 80`,
    ),
    check(
      'user_profiles_avatar_key_check',
      sql`${t.avatarKey} is null or ${t.avatarKey} ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}\\.webp$'`,
    ),
  ],
);

export type AchievementAudience = 'staff' | 'customer';

/**
 * Achievements are data, not code (PR1/D15 "Præstationer"): the metric is a key the app knows how
 * to compute from existing tables; threshold, window, texts and icon live here. A definition
 * whose metric has no data yet is disabled and never shown.
 */
export const achievementDefinitions = pgTable(
  'achievement_definitions',
  {
    key: text('key').primaryKey(),
    audience: text('audience').$type<AchievementAudience>().notNull(),
    /** i18n keys under profile.achievements.<key> (title, description). */
    icon: text('icon').notNull(),
    metric: text('metric').notNull(),
    threshold: integer('threshold').notNull(),
    windowDays: integer('window_days'),
    sortOrder: integer('sort_order').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [
    check('achievement_definitions_audience_check', sql`${t.audience} in ('staff', 'customer')`),
    check('achievement_definitions_threshold_check', sql`${t.threshold} > 0`),
  ],
);

/** When a user earned an achievement. Own rows only (RLS). */
export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    key: text('key')
      .notNull()
      .references(() => achievementDefinitions.key, { onDelete: 'cascade' }),
    earnedAt: ts('earned_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('user_achievements_user_idx').on(t.userId),
  ],
);
