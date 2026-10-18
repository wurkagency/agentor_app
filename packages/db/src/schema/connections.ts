import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { tenants } from './tenancy.js';

export const connections = pgTable(
  'connections',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    connectorId: text('connector_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ok'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
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
