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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('cases_tenant_idx').on(t.tenantId, t.createdAt),
    index('cases_status_idx').on(t.status, t.updatedAt),
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
  ],
);

/** A running timer per staff member ("Start timer", S3). */
export const timers = platformSchema.table('timers', {
  staffUserId: uuid('staff_user_id').primaryKey(),
  caseId: uuid('case_id'),
  startedAt: ts('started_at').notNull().defaultNow(),
});
