import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './columns.js';
import { plans } from './plans.js';
import { tenants } from './tenancy.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const SUBSCRIPTION_STATUSES = ['incomplete', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
/** Billed in advance, monthly or yearly; a year costs 10 months (README decision 18). */
export type BillingInterval = 'month' | 'year';
/** Card and MobilePay go through QuickPay; Enterprise may pay on invoice with EAN. */
export type PaymentMethod = 'card' | 'mobilepay' | 'invoice';

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
    interval: text('interval').$type<BillingInterval>().notNull().default('month'),
    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull().default('card'),
    /** EAN for invoice payment (Enterprise). */
    ean: text('ean'),
    /** Trial: the first charge is at trial end. */
    trialEndsAt: ts('trial_ends_at'),
    /** Cancelled by the customer: runs to this date and is not renewed. */
    cancelAt: ts('cancel_at'),
    /** Discount on the plan price, set by Superadmin (F2). */
    discountPct: integer('discount_pct'),
    discountUntil: ts('discount_until'),
    /** The plan price version charged (A2). Set by trigger from the plan's newest version. */
    priceVersionId: uuid('price_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('subscriptions_tenant_key').on(t.tenantId),
    check('subscriptions_interval_check', sql`${t.interval} in ('month', 'year')`),
    check(
      'subscriptions_payment_method_check',
      sql`${t.paymentMethod} in ('card', 'mobilepay', 'invoice')`,
    ),
    check('subscriptions_ean_check', sql`${t.ean} is null or ${t.ean} ~ '^[0-9]{13}$'`),
    check(
      'subscriptions_discount_check',
      sql`${t.discountPct} is null or (${t.discountPct} > 0 and ${t.discountPct} <= 100)`,
    ),
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
    /** E21 "Kvote over 80 %" was sent for this period (at most once a month per tenant). */
    quotaNotifiedAt: ts('quota_notified_at'),
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

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'failed', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceKind = 'subscription' | 'support';

/**
 * An invoice line. Subscription invoices have plain lines; support invoices have one line per
 * case with registered and billed minutes (each registration rounded up to 15 min, F5).
 */
export interface InvoiceLine {
  text: string;
  amountOre: number;
  caseId?: string;
  caseNumber?: number;
  registeredMinutes?: number;
  billedMinutes?: number;
  rateOre?: number;
  detail?: string;
  /** Added by hand on Finans (F5 "Tilføj linje"), e.g. a goodwill discount; kept on refresh. */
  manual?: boolean;
  /** The registrations behind a case line, for the time log on the invoice. */
  log?: { date: string; registeredMinutes: number; billedMinutes: number }[];
}

export const invoices = pgTable(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** AG-YYYY-NNNN (D13), allocated from a global sequence; null while a draft. */
    number: text('number'),
    kind: text('kind').$type<InvoiceKind>().notNull().default('subscription'),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end').notNull(),
    description: text('description').notNull(),
    /** Extra lines next to the plan, e.g. billable support time (M8). Amounts are net øre. */
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull().default([]),
    amountOre: integer('amount_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    status: text('status').$type<InvoiceStatus>().notNull().default('open'),
    providerPaymentId: text('provider_payment_id'),
    paidAt: ts('paid_at'),
    /** How it was paid or is to be paid: card, mobilepay, invoice (EAN or bank transfer). */
    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull().default('card'),
    issuedAt: ts('issued_at'),
    dueAt: ts('due_at'),
    /** Support drafts: approved by Superadmin, then sent on the 1st at 08:00 (F5). */
    approvedAt: ts('approved_at'),
    approvedByName: text('approved_by_name'),
    sendAt: ts('send_at'),
    /** Failed card charges are retried after 2, 5 and 9 days (README decision 18). */
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: ts('next_retry_at'),
    reminders: integer('reminders').notNull().default(0),
    /** Support invoices: print the time log (date and minutes per registration) on the PDF. */
    attachTimelog: boolean('attach_timelog').notNull().default(true),
    lastReminderAt: ts('last_reminder_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('invoices_number_key').on(t.number),
    unique('invoices_period_key').on(t.tenantId, t.kind, t.periodStart),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    check('invoices_status_check', sql`${t.status} in ('draft', 'open', 'paid', 'failed', 'void')`),
    check('invoices_kind_check', sql`${t.kind} in ('subscription', 'support')`),
    check(
      'invoices_payment_method_check',
      sql`${t.paymentMethod} in ('card', 'mobilepay', 'invoice')`,
    ),
    check('invoices_number_check', sql`${t.status} = 'draft' or ${t.number} is not null`),
    check('invoices_amounts_check', sql`${t.amountOre} >= 0 and ${t.vatOre} >= 0`),
  ],
);

export const CREDIT_REFUND_METHODS = ['card', 'offset'] as const;
export type CreditRefundMethod = (typeof CREDIT_REFUND_METHODS)[number];
export const CREDIT_REFUND_STATES = ['none', 'pending', 'done', 'failed'] as const;
export type CreditRefundState = (typeof CREDIT_REFUND_STATES)[number];

/**
 * Credit notes (I02, PLAN-EMAILS-PDF §7): K-ÅÅÅÅ-nnnn from a gap-free yearly counter, always for
 * one invoice, which is never changed. Created only through app.create_credit_note(), which
 * checks that the credit never exceeds what is still uncredited. Amounts are net øre, negative.
 */
export const creditNotes = pgTable(
  'credit_notes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceIssuedAt: ts('invoice_issued_at').notNull(),
    reason: text('reason').notNull(),
    /** Back to the card through QuickPay, or set off against the next invoice. */
    refundMethod: text('refund_method').$type<CreditRefundMethod>().notNull(),
    /** Card refunds: done only on QuickPay's confirmation. */
    refundState: text('refund_state').$type<CreditRefundState>().notNull().default('none'),
    refundPaymentId: text('refund_payment_id'),
    refundedAt: ts('refunded_at'),
    /** Set-off: the invoice that took the credit. */
    offsetInvoiceId: uuid('offset_invoice_id'),
    netOre: integer('net_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    createdByUserId: uuid('created_by_user_id'),
    createdByName: text('created_by_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('credit_notes_number_key').on(t.number),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    index('credit_notes_invoice_idx').on(t.tenantId, t.invoiceId),
    check('credit_notes_amounts_check', sql`${t.netOre} < 0 and ${t.vatOre} <= 0`),
    check('credit_notes_refund_method_check', sql`${t.refundMethod} in ('card', 'offset')`),
    check(
      'credit_notes_refund_state_check',
      sql`${t.refundState} in ('none', 'pending', 'done', 'failed')`,
    ),
    check('credit_notes_number_format', sql`${t.number} ~ '^K-[0-9]{4}-[0-9]{4,}$'`),
  ],
);

/** The credited lines: which invoice line (index), how much of it, negative amounts. */
export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    creditNoteId: uuid('credit_note_id').notNull(),
    /** The line's position in the invoice's line list (app.invoice_lines). */
    sourceIndex: integer('source_index').notNull(),
    text: text('text').notNull(),
    detail: text('detail'),
    unit: text('unit').$type<'hours' | 'pieces'>().notNull(),
    /** Thousandths of an hour or a piece, negative. */
    quantityMilli: integer('quantity_milli').notNull(),
    unitPriceOre: integer('unit_price_ore'),
    amountOre: integer('amount_ore').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.creditNoteId],
      foreignColumns: [creditNotes.tenantId, creditNotes.id],
    }).onDelete('cascade'),
    check('credit_note_lines_amount_check', sql`${t.amountOre} < 0 and ${t.quantityMilli} <= 0`),
    check('credit_note_lines_unit_check', sql`${t.unit} in ('hours', 'pieces')`),
  ],
);
