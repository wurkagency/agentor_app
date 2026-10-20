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
  timestamp,
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
    /** Number for critical SMS alerts (D14-Onboarding-1). */
    smsPhone: text('sms_phone'),
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
    /** Onboarding (D14) and activation: "første testkørsel gennemført" (produktspecifikation §7.9). */
    ordersPerMonth: text('orders_per_month'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    firstTestRunAt: timestamp('first_test_run_at', { withTimezone: true, mode: 'date' }),
    /**
     * Self-service signup (PLAN-SIGNUP §3.1): pending_plan → pending_payment → active. Only a
     * verified QuickPay callback for the first invoice makes a tenant active; nothing in the app
     * works before that. Changed only by app.signup_* functions.
     */
    signupState: text('signup_state').notNull().default('active'),
    signupStateAt: timestamp('signup_state_at', { withTimezone: true, mode: 'date' }),
    /** Systems chosen on SU3 (connector ids); pre-select onboarding and drive recommendations. */
    chosenConnectors: text('chosen_connectors')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Onboarding after payment (OB1–OB5); null before activation. */
    onboardingStep: text('onboarding_step'),
    onboardingSkippedAt: timestamp('onboarding_skipped_at', { withTimezone: true, mode: 'date' }),
    /** The draft flow created from the template on OB3. */
    onboardingFlowId: uuid('onboarding_flow_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_alert_rate_check', sql`${t.alertErrorRatePct} between 1 and 100`),
    check('tenants_alert_failures_check', sql`${t.alertConsecutiveFailures} between 1 and 100`),
    check('tenants_locale_check', sql`${t.locale} in ('da', 'en')`),
    check('tenants_status_check', sql`${t.status} in ('active', 'suspended', 'deleting')`),
    check(
      'tenants_signup_state_check',
      sql`${t.signupState} in ('pending_plan', 'pending_payment', 'active')`,
    ),
    check(
      'tenants_onboarding_step_check',
      sql`${t.onboardingStep} in ('webshop', 'accounting', 'template', 'test', 'done')`,
    ),
    check('tenants_chosen_connectors_check', sql`cardinality(${t.chosenConnectors}) <= 30`),
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
    /** External users (agency, accountant) are tagged "Ekstern"; they take a seat like everyone. */
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

export const TERMS_DOCUMENTS = ['subscription_terms', 'privacy_policy', 'dpa'] as const;
export type TermsDocument = (typeof TERMS_DOCUMENTS)[number];

/**
 * "Accept af betingelser" on SU5/MS5: one row per document per acceptance, with the version
 * shown on agentor.dk at that moment (PLAN-SIGNUP B12). Append-only, like the audit log.
 */
export const termsAcceptances = pgTable(
  'terms_acceptances',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    document: text('document').$type<TermsDocument>().notNull(),
    version: text('version').notNull(),
    url: text('url').notNull(),
    ip: text('ip'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('terms_acceptances_tenant_idx').on(t.tenantId, t.acceptedAt),
    check(
      'terms_acceptances_document_check',
      sql`${t.document} in ('subscription_terms', 'privacy_policy', 'dpa')`,
    ),
    check('terms_acceptances_version_check', sql`length(${t.version}) between 1 and 80`),
  ],
);
