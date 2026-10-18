import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { memberships, tenants } from './tenancy.js';

export const flows = pgTable(
  'flows',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
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
