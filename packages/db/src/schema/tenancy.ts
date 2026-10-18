import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users as authUsers } from './auth.js';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';

export const tenants = pgTable(
  'tenants',
  {
    id: idColumn().primaryKey(),
    name: text('name').notNull(),
    cvr: text('cvr'),
    addressLine: text('address_line'),
    postalCode: text('postal_code'),
    city: text('city'),
    billingEmail: text('billing_email'),
    locale: text('locale').notNull().default('da'),
    timeZone: text('time_zone').notNull().default('Europe/Copenhagen'),
    currency: text('currency').notNull().default('DKK'),
    status: text('status').notNull().default('active'),
    /** "Kræv totrin for hele teamet" (D12-Sikkerhed). */
    requireMfaAll: boolean('require_mfa_all').notNull().default(false),
    /** Break-glass needs approval by an owner or admin (D8). On by default. */
    supportRequiresApproval: boolean('support_requires_approval').notNull().default(true),
    /** Status thresholds (produktspecifikation §7.1), adjustable per tenant. */
    alertErrorRatePct: integer('alert_error_rate_pct').notNull().default(5),
    alertConsecutiveFailures: integer('alert_consecutive_failures').notNull().default(3),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_alert_rate_check', sql`${t.alertErrorRatePct} between 1 and 100`),
    check('tenants_alert_failures_check', sql`${t.alertConsecutiveFailures} between 1 and 100`),
    check('tenants_locale_check', sql`${t.locale} in ('da', 'en')`),
    check('tenants_status_check', sql`${t.status} in ('active', 'suspended', 'deleting')`),
  ],
);

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'developer', 'reader'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const memberships = pgTable(
  'memberships',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').$type<MembershipRole>().notNull(),
    /** 'all' = every flow; 'selected' = only flows in flow_grants. */
    flowScope: text('flow_scope').$type<'all' | 'selected'>().notNull().default('all'),
    /** External users (agency, accountant) are tagged "Ekstern" and don't use a seat (PLAN Q1b). */
    isExternal: boolean('is_external').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('memberships_tenant_user_key').on(t.tenantId, t.userId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} in ('owner', 'admin', 'developer', 'reader')`),
    check('memberships_flow_scope_check', sql`${t.flowScope} in ('all', 'selected')`),
    check(
      'memberships_selected_only_dev_reader',
      sql`${t.flowScope} = 'all' or ${t.role} in ('developer', 'reader')`,
    ),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    actorUserId: uuid('actor_user_id'),
    actorKind: text('actor_kind').$type<'user' | 'support' | 'system'>().notNull(),
    /** Display name at the time of the action, e.g. "Mette Holm" or "Anne · Agentor". */
    actorName: text('actor_name'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('audit_log_actor_kind_check', sql`${t.actorKind} in ('user', 'support', 'system')`),
  ],
);
