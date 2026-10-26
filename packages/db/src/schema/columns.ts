import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Binary column (ciphertext, nonces, wrapped keys). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** UUID v7 primary key generated in the database (see migration 0000_app_functions). */
export const idColumn = () =>
  uuid('id')
    .notNull()
    .default(sql`app.uuid_v7()`);

/** Every tenant table carries tenant_id first in its keys (produktspecifikation §9.1). */
export const tenantIdColumn = () => uuid('tenant_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
