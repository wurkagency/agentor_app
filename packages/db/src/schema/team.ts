import { sql } from 'drizzle-orm';
import {
  integer,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { tenants, type MembershipRole } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Invitations (D11-Inviter). The link carries a random token; only its SHA-256 is stored.
 * Looked up and accepted through SECURITY DEFINER functions, since the invitee has no tenant
 * context yet.
 */
export const invitations = pgTable(
  'invitations',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    email: text('email').notNull(),
    role: text('role').$type<Exclude<MembershipRole, 'owner'>>().notNull(),
    flowScope: text('flow_scope').$type<'all' | 'selected'>().notNull().default('all'),
    flowIds: uuid('flow_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    accessExpiresAt: ts('access_expires_at'),
    isExternal: boolean('is_external').notNull().default(false),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    invitedBy: uuid('invited_by').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('invitations_token_hash_key').on(t.tokenHash),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('invitations_tenant_email_idx').on(t.tenantId, t.email),
    check('invitations_role_check', sql`${t.role} in ('owner', 'admin', 'developer', 'reader')`),
    check(
      'invitations_scope_check',
      sql`${t.flowScope} = 'all' or ${t.role} in ('developer', 'reader')`,
    ),
    check('invitations_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
);

export const NOTIFICATION_EVENTS = [
  'connection_broken',
  'systematic_error',
  'record_failed',
  'quota',
  'payment_failed',
  'connector_update',
  'weekly_summary',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Per-user channel choices per event (D12-Notifikationer: "Gælder kun dig"). */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    event: text('event').$type<NotificationEvent>().notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(false),
    push: boolean('push').notNull().default(false),
    sms: boolean('sms').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('notification_prefs_user_event_key').on(t.tenantId, t.userId, t.event),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  ],
);

/** Per-user delivery settings: quiet hours and SMS number. */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    quietEnabled: boolean('quiet_enabled').notNull().default(true),
    quietStart: text('quiet_start').notNull().default('22:00'),
    quietEnd: text('quiet_end').notNull().default('07:00'),
    smsPhone: text('sms_phone'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('notification_settings_user_key').on(t.tenantId, t.userId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    check(
      'notification_settings_quiet_format',
      sql`${t.quietStart} ~ '^[0-2][0-9]:[0-5][0-9]$' and ${t.quietEnd} ~ '^[0-2][0-9]:[0-5][0-9]$'`,
    ),
  ],
);

/**
 * Break-glass support access (produktspecifikation §9.7, PLAN Q8): up to 24 hours, visible to
 * the customer, approval optional per tenant. Created only through app.support_request_access().
 */
export const supportAccessGrants = pgTable(
  'support_access_grants',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    caseRef: text('case_ref').notNull(),
    reason: text('reason').notNull(),
    supportName: text('support_name').notNull(),
    requestedAt: createdAt(),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    deniedAt: ts('denied_at'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    /** Agentor Platform (M8): the staff member, the case, and how far the access reaches. */
    staffUserId: uuid('staff_user_id'),
    caseId: uuid('case_id'),
    scope: text('scope').$type<'view' | 'help'>().notNull().default('view'),
    hours: integer('hours').notNull().default(1),
    /**
     * Superadmin opened the customer's app directly (decided by Charlie, 19 Oct 2026): no
     * request and no approval; it shows only in the customer's audit log.
     */
    superadmin: boolean('superadmin').notNull().default(false),
    endedAt: ts('ended_at'),
    extensionRequestedAt: ts('extension_requested_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    // At most 24 hours of access, counted from when it starts (approval, or the request when
    // the customer doesn't require approval).
    check(
      'support_grant_max_24h',
      sql`${t.expiresAt} <= coalesce(${t.approvedAt}, ${t.requestedAt}) + interval '24 hours'`,
    ),
  ],
);

/**
 * In-app notifications (bell, D2-Notifikationer), one row per recipient. Written by the worker
 * after the recipient's preferences are applied; each user sees only their own.
 */
export const notifications = pgTable(
  'notifications',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    event: text('event').notNull(),
    /** Needs the customer to act (Kraever handling) or just information. */
    needsAction: boolean('needs_action').notNull().default(false),
    /** i18n key under notificationsPanel.items and its parameters. */
    messageKey: text('message_key').notNull(),
    params: jsonb('params').$type<Record<string, string | number>>().notNull().default({}),
    href: text('href'),
    flowId: uuid('flow_id'),
    connectionId: uuid('connection_id'),
    readAt: ts('read_at'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('notifications_user_idx').on(t.tenantId, t.userId, t.createdAt),
  ],
);
