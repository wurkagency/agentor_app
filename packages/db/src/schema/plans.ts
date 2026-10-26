import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn } from './columns.js';

/** Global, read-only for runtime roles. Plans are data, not code (produktspecifikation §11). */
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priceMonthlyOre: integer('price_monthly_ore').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const planEntitlements = pgTable(
  'plan_entitlements',
  {
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.key] })],
);

export type PriceAppliesTo = 'new' | 'all_from_renewal';

/**
 * Plan price versions (A2 Abonnementer, "Når priserne ændres"). Saving a plan creates a version
 * with the price and a snapshot of the entitlements. A subscription keeps the version it was
 * created with; "all from next renewal" moves it at its first renewal after the notice period.
 * Global, read-only for runtime roles; written by app.platform_price_version_create.
 */
export const planPriceVersions = pgTable(
  'plan_price_versions',
  {
    id: idColumn(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    priceMonthlyOre: integer('price_monthly_ore').notNull(),
    entitlements: jsonb('entitlements').$type<Record<string, unknown>>().notNull().default({}),
    appliesTo: text('applies_to').$type<PriceAppliesTo>().notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
    /** "Alle fra næste fornyelse": when the customers were told by e-mail. */
    noticeSentAt: timestamp('notice_sent_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by'),
    createdByName: text('created_by_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index('plan_price_versions_plan_idx').on(t.planId, t.effectiveFrom),
    check('plan_price_versions_applies_check', sql`${t.appliesTo} in ('new', 'all_from_renewal')`),
    check('plan_price_versions_price_check', sql`${t.priceMonthlyOre} between 0 and 10000000`),
  ],
);
