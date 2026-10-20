import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Identity and authentication (Better Auth), in its own schema "auth" (ADR 0004).
 *
 * Identity is global and exists before a tenant is chosen, so tenant RLS can't apply here.
 * Only agentor_web can touch this schema; worker, support and ops roles have no access
 * (enforced by check-rls and the isolation suite). Property names match Better Auth's model
 * fields; column names are snake_case.
 */
export const authSchema = pgSchema('auth');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = authSchema.table(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /** UI language, "da" or "en" (profile menu "Sprog"). */
    locale: text('locale').notNull().default('da'),
    /**
     * Set when self-service signup created the account, cleared when its company becomes active.
     * Only such accounts are deleted after 24 hours (PLAN-SIGNUP B1); invited users never are.
     */
    signupStartedAt: ts('signup_started_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('users_email_key').on(t.email),
    check('users_email_lower', sql`${t.email} = lower(${t.email})`),
    check('users_locale_check', sql`${t.locale} in ('da', 'en')`),
  ],
);

export const sessions = authSchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    token: text('token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Tenant the session works in. Validated against memberships on every request. */
    activeTenantId: uuid('active_tenant_id'),
    /**
     * Signed in with Google or Microsoft. Such a session has passed no second factor of ours, so
     * owners and admins confirm with TOTP or a passkey before the app (PLAN-SIGNUP B10), which
     * sets mfa_verified_at.
     */
    ssoLogin: boolean('sso_login').notNull().default(false),
    mfaVerifiedAt: ts('mfa_verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('sessions_token_key').on(t.token), index('sessions_user_idx').on(t.userId)],
);

export const accounts = authSchema.table(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    /** Argon2id hash (produktspecifikation §9.5). */
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = authSchema.table(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactors = authSchema.table(
  'two_factors',
  {
    id: uuid('id').primaryKey(),
    /** Encrypted by Better Auth with BETTER_AUTH_SECRET. */
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: ts('locked_until'),
  },
  (t) => [index('two_factors_user_idx').on(t.userId)],
);

export const passkeys = authSchema.table(
  'passkeys',
  {
    id: uuid('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: ts('created_at').defaultNow(),
  },
  (t) => [
    index('passkeys_user_idx').on(t.userId),
    index('passkeys_credential_idx').on(t.credentialID),
  ],
);
