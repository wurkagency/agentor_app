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
import { connections } from './connections.js';
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
    /** Earliest automatic retry of a failed record (1 min → 6 h backoff, at most 8 tries). */
    nextRetryAt: ts('next_retry_at'),
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
    /** Source ids a webhook named; the run reads just these. */
    sourceIds: jsonb('source_ids').$type<{ entity: string; ids: string[] }>(),
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
    /** Which try this was (1 = first). */
    attempts: integer('attempts').notNull().default(1),
    /** Why it failed: invalid, mapping and dependency need the customer; the rest retry. */
    failure: text('failure'),
    /** When it is tried again automatically; null when it isn't (needs action, or 8 tries). */
    nextRetryAt: ts('next_retry_at'),
    sourceVersion: text('source_version'),
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
    index('run_records_retry_idx')
      .on(t.tenantId, t.flowId, t.nextRetryAt)
      .where(sql`next_retry_at is not null and resolved_at is null`),
  ],
);

/**
 * Idempotency key (produktspecifikation §4.1): a source record version is processed once per
 * flow. A changed record has a new version and runs again; an unchanged one never does.
 */
export const syncItems = pgTable(
  'sync_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    flowId: uuid('flow_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    entity: text('entity').notNull(),
    sourceId: text('source_id').notNull(),
    sourceVersion: text('source_version').notNull(),
    runId: uuid('run_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    unique('sync_items_key').on(
      t.tenantId,
      t.flowId,
      t.connectionId,
      t.entity,
      t.sourceId,
      t.sourceVersion,
    ),
    index('sync_items_created_idx').on(t.tenantId, t.createdAt),
  ],
);

/** Polling cursor per flow, connection and entity: read again from here minus 2 minutes. */
export const syncCursors = pgTable(
  'sync_cursors',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    flowId: uuid('flow_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    entity: text('entity').notNull(),
    cursor: ts('cursor').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.flowId],
      foreignColumns: [flows.tenantId, flows.id],
    }).onDelete('cascade'),
    unique('sync_cursors_key').on(t.tenantId, t.flowId, t.connectionId, t.entity),
  ],
);

/**
 * Fetched source records of a run, so route jobs carry ids only (§4.1: job payloads never hold
 * personal data). Deleted when the run finishes; the retention sweep removes leftovers.
 */
export const syncPayloads = pgTable(
  'sync_payloads',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid('run_id').notNull(),
    entity: text('entity').notNull(),
    sourceId: text('source_id').notNull(),
    sourceVersion: text('source_version').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete('cascade'),
    unique('sync_payloads_key').on(t.tenantId, t.runId, t.entity, t.sourceId),
  ],
);

/**
 * What Agentor wrote where, per destination connection: dependency resolution (is the customer
 * already in Dinero?) and echo suppression (a change we made ourselves coming back as an event).
 */
export const entityLinks = pgTable(
  'entity_links',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectionId: uuid('connection_id').notNull(),
    entity: text('entity').notNull(),
    sourceConnectionId: uuid('source_connection_id').notNull(),
    sourceId: text('source_id').notNull(),
    destinationId: text('destination_id').notNull(),
    writtenAt: ts('written_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }).onDelete('cascade'),
    unique('entity_links_key').on(
      t.tenantId,
      t.connectionId,
      t.entity,
      t.sourceConnectionId,
      t.sourceId,
    ),
    index('entity_links_destination_idx').on(t.tenantId, t.connectionId, t.destinationId),
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
