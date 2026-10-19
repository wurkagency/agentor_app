import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { plans } from './plans.js';
import { tenants } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const SUBSCRIPTION_STATUSES = ['incomplete', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * One subscription per tenant (QuickPay subscriptions, D4). Plan limits come from
 * plan_entitlements; nothing about plans is hardcoded.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    status: text('status').$type<SubscriptionStatus>().notNull().default('incomplete'),
    /** QuickPay subscription id; null until the card is added. */
    providerSubscriptionId: text('provider_subscription_id'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    cardExpiry: text('card_expiry'),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    pastDueSince: ts('past_due_since'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('subscriptions_tenant_key').on(t.tenantId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    index('subscriptions_period_end_idx').on(t.currentPeriodEnd),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('incomplete', 'active', 'past_due', 'cancelled')`,
    ),
    check(
      'subscriptions_last4_check',
      sql`${t.cardLast4} is null or ${t.cardLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
);

/** Monthly usage: successful Live writes per destination (D2). */
export const usageCounters = pgTable(
  'usage_counters',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** Billing month, "YYYY-MM". */
    period: text('period').notNull(),
    transactions: integer('transactions').notNull().default(0),
    /** When the period's quota was first reached; starts the 7-day grace (D2). */
    exceededAt: ts('exceeded_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('usage_counters_period_key').on(t.tenantId, t.period),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    check('usage_counters_period_format', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/** Purchased add-ons, e.g. extra transactions for one period. */
export const addons = pgTable(
  'addons',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kind: text('kind').$type<'transactions'>().notNull(),
    quantity: integer('quantity').notNull(),
    period: text('period').notNull(),
    priceOre: integer('price_ore').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    check('addons_kind_check', sql`${t.kind} in ('transactions')`),
    check('addons_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export const INVOICE_STATUSES = ['open', 'paid', 'failed', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = pgTable(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** AG-YYYY-NNNN (D13), allocated from a global sequence. */
    number: text('number').notNull(),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end').notNull(),
    description: text('description').notNull(),
    amountOre: integer('amount_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    status: text('status').$type<InvoiceStatus>().notNull().default('open'),
    providerPaymentId: text('provider_payment_id'),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('invoices_number_key').on(t.number),
    unique('invoices_period_key').on(t.tenantId, t.periodStart),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    check('invoices_status_check', sql`${t.status} in ('open', 'paid', 'failed', 'void')`),
    check('invoices_amounts_check', sql`${t.amountOre} >= 0 and ${t.vatOre} >= 0`),
  ],
);
