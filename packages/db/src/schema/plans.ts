import { integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

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
