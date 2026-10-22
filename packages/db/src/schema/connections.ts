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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { tenants } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const CONNECTION_STATUSES = ['checking', 'ok', 'broken'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A customer's account in a connected system (D9). Credentials are never here: they live
 * sealed in connection_secrets. The webhook token is stored only as a hash.
 */
export const connections = pgTable(
  'connections',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectorId: text('connector_id').notNull(),
    /** Customer-facing name: the account ("nordlys-cykler.dk", "Nordlys Cykler"). */
    name: text('name').notNull(),
    status: text('status').$type<ConnectionStatus>().notNull().default('checking'),
    /** Why it is broken, in the customer's language (e.g. access revoked in Dinero). */
    statusReason: text('status_reason'),
    brokenSince: ts('broken_since'),
    accountId: text('account_id'),
    connectorVersion: text('connector_version').notNull().default('1.0.0'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    configuredBy: uuid('configured_by'),
    configuredByName: text('configured_by_name'),
    lastCheckedAt: ts('last_checked_at'),
    /** Records counted at the last successful test, for the entities the manifest can count. */
    recordCounts: jsonb('record_counts').$type<Partial<Record<string, number>>>(),
    lastWebhookAt: ts('last_webhook_at'),
    tokenExpiresAt: ts('token_expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('connections_connector_idx').on(t.tenantId, t.connectorId),
    check('connections_status_check', sql`${t.status} in ('checking', 'ok', 'broken')`),
  ],
);

/**
 * Inbound webhook bodies (produktspecifikation §9.4): written by agentor-ingest through
 * app.ingest_webhook(), verified and processed by the worker. Jobs carry only the event id.
 * The web role cannot read them (payloads hold personal data).
 */
export const inboundEvents = pgTable(
  'inbound_events',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectionId: uuid('connection_id').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    body: bytea('body').notNull(),
    status: text('status').$type<'queued' | 'accepted' | 'rejected'>().notNull().default('queued'),
    reason: text('reason'),
    /** The sender's delivery id; a repeated delivery is dropped. */
    deliveryId: text('delivery_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }).onDelete('cascade'),
    index('inbound_events_received_idx').on(t.tenantId, t.receivedAt),
    uniqueIndex('inbound_events_delivery_key')
      .on(t.tenantId, t.connectionId, t.deliveryId)
      .where(sql`delivery_id is not null`),
    check('inbound_events_status_check', sql`${t.status} in ('queued', 'accepted', 'rejected')`),
  ],
);

/**
 * Per-tenant data encryption key (DEK), wrapped by the key encryption key (KEK).
 * Only agentor_worker can read this table (produktspecifikation §9.2).
 */
export const tenantKeys = pgTable(
  'tenant_keys',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kekId: text('kek_id').notNull(),
    wrappedDek: bytea('wrapped_dek').notNull(),
    createdAt: createdAt(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  ],
);

/**
 * Encrypted connection credentials. agentor_web can only insert through
 * app.insert_connection_secret(); only agentor_worker can SELECT.
 */
export const connectionSecrets = pgTable(
  'connection_secrets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectionId: uuid('connection_id').notNull(),
    /** Envelope format, so the scheme can change without a data migration (see docs/adr). */
    format: text('format').notNull(),
    keyId: uuid('key_id'),
    keyVersion: integer('key_version').notNull().default(1),
    nonce: bytea('nonce').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }).onDelete('cascade'),
    check('connection_secrets_format_check', sql`length(${t.format}) between 1 and 64`),
  ],
);

/** Live lookup lists from a destination (chart of accounts, VAT codes), fetched by the worker. */
export const connectionLookups = pgTable(
  'connection_lookups',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectionId: uuid('connection_id').notNull(),
    list: text('list').$type<'accounts' | 'vatCodes' | 'templates'>().notNull(),
    options: jsonb('options').$type<{ value: string; label: string }[]>().notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }).onDelete('cascade'),
    uniqueIndex('connection_lookups_list_key').on(t.tenantId, t.connectionId, t.list),
  ],
);
