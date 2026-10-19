import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { memberships, tenants } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const flows = pgTable(
  'flows',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    /** Legacy column from M0; the status is derived from versions, routes and runs. */
    status: text('status').notNull().default('draft'),
    publishedVersionId: uuid('published_version_id'),
    /** Whole flow paused (D2 "Pause"); route-level pauses live in the definition. */
    pausedAt: ts('paused_at'),
    pausedByName: text('paused_by_name'),
    /**
     * Route pauses are operational state, not part of the immutable version (D2 "Pauset af
     * Jonas Krag" with Genoptag): routeId → who paused it and when.
     */
    routePauses: jsonb('route_pauses')
      .$type<Record<string, { at: string; by: string }>>()
      .notNull()
      .default({}),
    /** Next scheduled poll, set by the worker after each run. */
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    /** Template the flow was created from (D4), if any. */
    template: text('template'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('flows_next_run_idx').on(t.nextRunAt),
  ],
);

/**
 * Immutable published versions plus at most one draft per flow (produktspecifikation §5.4).
 * In-flight runs finish on the version they started with.
 */
export const flowVersions = pgTable(
  'flow_versions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    flowId: uuid('flow_id').notNull(),
    /** 1, 2, ... for published versions; null for the draft. */
    number: integer('number'),
    state: text('state').$type<'draft' | 'published' | 'archived'>().notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    authorName: text('author_name'),
    /** Draft lock: one editor at a time (section 5.4). */
    lockedBy: uuid('locked_by'),
    lockedByName: text('locked_by_name'),
    lockedAt: ts('locked_at'),
    publishedAt: ts('published_at'),
    publishedByName: text('published_by_name'),
    changeSummary: jsonb('change_summary').$type<unknown[]>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    unique('flow_versions_number_key').on(t.tenantId, t.flowId, t.number),
    uniqueIndex('flow_versions_one_draft')
      .on(t.tenantId, t.flowId)
      .where(sql`state = 'draft'`),
    check('flow_versions_state_check', sql`${t.state} in ('draft', 'published', 'archived')`),
  ],
);

/** One execution of a flow version (scheduled, webhook, manual, test or retry). */
export const runs = pgTable(
  'runs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    flowId: uuid('flow_id').notNull(),
    versionId: uuid('version_id').notNull(),
    kind: text('kind').$type<'scheduled' | 'webhook' | 'manual' | 'test' | 'retry'>().notNull(),
    status: text('status')
      .$type<'queued' | 'running' | 'ok' | 'partial' | 'failed' | 'test'>()
      .notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    recordsTotal: integer('records_total').notNull().default(0),
    recordsOk: integer('records_ok').notNull().default(0),
    recordsFailed: integer('records_failed').notNull().default(0),
    recordsSkipped: integer('records_skipped').notNull().default(0),
    durationMs: integer('duration_ms'),
    requestedByName: text('requested_by_name'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    index('runs_flow_started_idx').on(t.tenantId, t.flowId, t.startedAt),
    check('runs_kind_check', sql`${t.kind} in ('scheduled', 'webhook', 'manual', 'test', 'retry')`),
    check(
      'runs_status_check',
      sql`${t.status} in ('queued', 'running', 'ok', 'partial', 'failed', 'test')`,
    ),
  ],
);

export type RecordOutcome =
  'created' | 'updated' | 'skipped' | 'failed' | 'would_create' | 'would_update' | 'waiting';

/**
 * What happened to each record on each route (Aktivitet, D10). Labels are order numbers or names,
 * never full payloads; the developer view's request/response is stored masked and expires with
 * the plan's payload retention.
 */
export const runRecords = pgTable(
  'run_records',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid('run_id').notNull(),
    flowId: uuid('flow_id').notNull(),
    routeId: text('route_id').notNull(),
    entity: text('entity').notNull(),
    sourceId: text('source_id').notNull(),
    label: text('label').notNull(),
    outcome: text('outcome').$type<RecordOutcome>().notNull(),
    mode: text('mode').$type<'test' | 'draft' | 'live'>().notNull(),
    amountOre: integer('amount_ore'),
    destinationId: text('destination_id'),
    errorCode: text('error_code'),
    errorParams: jsonb('error_params').$type<Record<string, string>>(),
    skipReason: text('skip_reason'),
    preview: jsonb('preview'),
    debug: jsonb('debug'),
    durationMs: integer('duration_ms'),
    /** Set when a later attempt for the same record and route succeeded. */
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete('cascade'),
    index('run_records_flow_created_idx').on(t.tenantId, t.flowId, t.createdAt),
    index('run_records_open_failures_idx')
      .on(t.tenantId, t.flowId, t.routeId)
      .where(sql`outcome = 'failed' and resolved_at is null`),
    index('run_records_label_idx').on(t.tenantId, t.label),
  ],
);

/** Cross-reference source id to destination id per route (updates, no duplicates; section 4.1). */
export const recordLinks = pgTable(
  'record_links',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    flowId: uuid('flow_id').notNull(),
    routeId: text('route_id').notNull(),
    sourceId: text('source_id').notNull(),
    destinationId: text('destination_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    unique('record_links_route_source_key').on(t.tenantId, t.flowId, t.routeId, t.sourceId),
  ],
);

/** Per-flow access for users whose membership has flow_scope = 'selected' (produktspecifikation §6). */
export const flowGrants = pgTable(
  'flow_grants',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    membershipId: uuid('membership_id').notNull(),
    flowId: uuid('flow_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('flow_grants_membership_flow_key').on(t.tenantId, t.membershipId, t.flowId),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    index('flow_grants_flow_idx').on(t.tenantId, t.flowId),
    check(
      'flow_grants_expiry_future',
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);
