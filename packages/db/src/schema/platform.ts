import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  unique,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, updatedAt } from './columns.js';
import { tenants } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Agentor Platform (README decisions 16–17): Agentor's own staff, support cases and support
 * time. Kept in its own schema: these rows belong to Agentor, not to a customer. Customers see
 * their own cases (without internal notes) through RLS; nobody gets customer data from here.
 */
export const platformSchema = pgSchema('platform');

export type StaffRole = 'superadmin' | 'supporter';

export const staff = platformSchema.table(
  'staff',
  {
    userId: uuid('user_id').primaryKey(),
    role: text('role').$type<StaffRole>().notNull(),
    /** "prøvetid til 30. nov." on P6. */
    probationUntil: ts('probation_until'),
    createdAt: createdAt(),
    createdByName: text('created_by_name'),
    disabledAt: ts('disabled_at'),
  },
  (t) => [check('staff_role_check', sql`${t.role} in ('superadmin', 'supporter')`)],
);

/** Platformindstillinger: hourly rate for billable support time, access rules. */
export const platformSettings = platformSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
  updatedByName: text('updated_by_name'),
});

export type CaseStatus = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type CasePriority = 'critical' | 'high' | 'normal' | 'low';

export const cases = platformSchema.table(
  'cases',
  {
    id: idColumn(),
    /** #2291 on the boards. */
    number: integer('number')
      .notNull()
      .default(sql`nextval('platform.case_number_seq')`),
    tenantId: uuid('tenant_id').notNull(),
    title: text('title').notNull(),
    status: text('status').$type<CaseStatus>().notNull().default('new'),
    priority: text('priority').$type<CasePriority>().notNull().default('normal'),
    /** Fejl, Mapping, Forbindelse, Opsætning, Abonnement, Ønske (S2). */
    category: text('category').notNull().default('question'),
    assigneeId: uuid('assignee_id'),
    assigneeName: text('assignee_name'),
    dueAt: ts('due_at'),
    flowId: uuid('flow_id'),
    createdByUserId: uuid('created_by_user_id'),
    createdByName: text('created_by_name').notNull(),
    /** 'customer' when opened from the app, 'staff' when a supporter opened it. */
    createdVia: text('created_via').notNull().default('customer'),
    resolution: text('resolution'),
    satisfied: boolean('satisfied'),
    /**
     * The case's own reply address (sag+<token>@…, PLAN-EMAILS-PDF Q4): set when E12 is first sent.
     * Random, unguessable; a reply to it is added as a customer message and reopens the case.
     */
    replyToken: text('reply_token'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('cases_tenant_idx').on(t.tenantId, t.createdAt),
    index('cases_status_idx').on(t.status, t.updatedAt),
    unique('cases_reply_token_key').on(t.replyToken),
    check(
      'cases_status_check',
      sql`${t.status} in ('new', 'in_progress', 'waiting', 'resolved', 'closed')`,
    ),
    check('cases_priority_check', sql`${t.priority} in ('critical', 'high', 'normal', 'low')`),
  ],
);

export type CaseEventKind =
  'customer_message' | 'reply' | 'internal_note' | 'status' | 'system' | 'access' | 'session';

/** The case timeline (S3). Internal notes, access and session events are staff-only. */
export const caseEvents = platformSchema.table(
  'case_events',
  {
    id: idColumn(),
    caseId: uuid('case_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    kind: text('kind').$type<CaseEventKind>().notNull(),
    authorUserId: uuid('author_user_id'),
    authorName: text('author_name').notNull(),
    body: text('body').notNull().default(''),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.caseId], foreignColumns: [cases.id] }).onDelete('cascade'),
    index('case_events_case_idx').on(t.caseId, t.createdAt),
    check(
      'case_events_kind_check',
      sql`${t.kind} in ('customer_message', 'reply', 'internal_note', 'status', 'system', 'access', 'session')`,
    ),
  ],
);

export const caseFollowers = platformSchema.table(
  'case_followers',
  {
    caseId: uuid('case_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.userId] }),
    foreignKey({ columns: [t.caseId], foreignColumns: [cases.id] }).onDelete('cascade'),
  ],
);

/** "Fastgjort kundenote" (S3, P2): staff notes about a customer, never shown to the customer. */
export const customerNotes = platformSchema.table(
  'customer_notes',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id').notNull(),
    body: text('body').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    authorUserId: uuid('author_user_id'),
    authorName: text('author_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('customer_notes_tenant_idx').on(t.tenantId),
  ],
);

/**
 * A stretch of work in a customer's app under a support grant (P4, S5). Minutes are counted
 * from first to last action with gaps over 10 minutes left out, and confirmed at the end.
 */
export const supportSessions = platformSchema.table(
  'support_sessions',
  {
    id: idColumn(),
    grantId: uuid('grant_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    staffUserId: uuid('staff_user_id').notNull(),
    caseId: uuid('case_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastActionAt: ts('last_action_at').notNull().defaultNow(),
    activeSeconds: integer('active_seconds').notNull().default(0),
    actions: jsonb('actions').$type<{ at: string; label: string }[]>().notNull().default([]),
    endedAt: ts('ended_at'),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('support_sessions_staff_idx').on(t.staffUserId, t.startedAt),
  ],
);

export type TimeKind = 'session' | 'phone' | 'email' | 'clarification' | 'meeting' | 'other';
export type NonBillableReason = 'agentor_error' | 'goodwill';

/** Support time (S3–S6). Billable entries go on the customer's next invoice. */
export const timeEntries = platformSchema.table(
  'time_entries',
  {
    id: idColumn(),
    staffUserId: uuid('staff_user_id').notNull(),
    staffName: text('staff_name').notNull(),
    caseId: uuid('case_id'),
    tenantId: uuid('tenant_id'),
    sessionId: uuid('session_id'),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    minutes: integer('minutes').notNull(),
    kind: text('kind').$type<TimeKind>().notNull(),
    source: text('source').$type<'auto' | 'manual' | 'timer'>().notNull(),
    description: text('description').notNull().default(''),
    billable: boolean('billable').notNull().default(false),
    /** Why non-billable time isn't billed (A2 "Ikke fakturerbar", A3). Null for billable time. */
    nonBillableReason: text('non_billable_reason').$type<NonBillableReason>(),
    invoiceId: uuid('invoice_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.caseId], foreignColumns: [cases.id] }).onDelete('set null'),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('time_entries_staff_idx').on(t.staffUserId, t.workDate),
    index('time_entries_tenant_idx').on(t.tenantId, t.workDate),
    check('time_entries_minutes_check', sql`${t.minutes} > 0 and ${t.minutes} <= 1440`),
    check(
      'time_entries_kind_check',
      sql`${t.kind} in ('session', 'phone', 'email', 'clarification', 'meeting', 'other')`,
    ),
    check('time_entries_source_check', sql`${t.source} in ('auto', 'manual', 'timer')`),
    check(
      'time_entries_non_billable_reason_check',
      sql`${t.nonBillableReason} is null or ${t.nonBillableReason} in ('agentor_error', 'goodwill')`,
    ),
  ],
);

/** A running timer per staff member ("Start timer", S3). */
export const timers = platformSchema.table('timers', {
  staffUserId: uuid('staff_user_id').primaryKey(),
  caseId: uuid('case_id'),
  startedAt: ts('started_at').notNull().defaultNow(),
});

/** Platform-audit-log (P6): staff and settings changes. Superadmin reads it. */
export const platformAudit = platformSchema.table(
  'audit',
  {
    id: idColumn(),
    actorUserId: uuid('actor_user_id').notNull(),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.id] }), index('platform_audit_created_idx').on(t.createdAt)],
);

export type IncidentKind = 'incident' | 'maintenance';
export type IncidentStatus = 'planned' | 'investigating' | 'monitoring' | 'resolved' | 'completed';

/** Hændelser and planned maintenance on System Status (A1, MP25). Superadmin only. */
export const incidents = platformSchema.table(
  'incidents',
  {
    id: idColumn(),
    kind: text('kind').$type<IncidentKind>().notNull(),
    title: text('title').notNull(),
    /** "Dinero-ruter · 412 kunder": what is affected, in words. */
    impact: text('impact').notNull().default(''),
    status: text('status').$type<IncidentStatus>().notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by').notNull(),
    createdByName: text('created_by_name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index('incidents_starts_idx').on(t.startsAt),
    check('incidents_kind_check', sql`${t.kind} in ('incident', 'maintenance')`),
    check(
      'incidents_status_check',
      sql`${t.status} in ('planned', 'investigating', 'monitoring', 'resolved', 'completed')`,
    ),
    check('incidents_title_check', sql`length(trim(${t.title})) between 1 and 200`),
    check('incidents_period_check', sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
  ],
);

/**
 * Support price versions (A2 Supportpris): the hourly rate ex. VAT, rounding and the billing rule.
 * A new version applies from its effective date (the 1st of the next billing period); the month
 * being billed uses the version in force at its start.
 */
export const supportPriceVersions = platformSchema.table(
  'support_price_versions',
  {
    id: idColumn(),
    rateOre: integer('rate_ore').notNull(),
    roundingMinutes: integer('rounding_minutes').notNull(),
    /** Which non-billable reasons may be chosen (A2 "Ikke fakturerbar"). */
    nonBillable: jsonb('non_billable').$type<string[]>().notNull().default([]),
    effectiveFrom: ts('effective_from').notNull(),
    createdBy: uuid('created_by'),
    createdByName: text('created_by_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index('support_price_versions_effective_idx').on(t.effectiveFrom),
    check('support_price_versions_rate_check', sql`${t.rateOre} between 0 and 10000000`),
    check(
      'support_price_versions_rounding_check',
      sql`${t.roundingMinutes} in (1, 5, 6, 10, 15, 30, 60)`,
    ),
  ],
);
