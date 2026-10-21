import {
  billingPeriod,
  overagePrice,
  parseEntitlements,
  planChangeBlockers,
  quotaState,
  withVat,
  INVOICE_DUE_DAYS,
  nextRetryAt,
  periodEndFor,
  subscriptionPriceOre,
  type CurrentUsage,
  type DowngradeBlocker,
  type Entitlements,
  type QuotaState,
} from '@agentor/core';
import { and, asc, count, desc, eq, gt, isNull, ne, sql, sum } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database, type Transaction } from '../client.js';
import {
  addons,
  flows,
  invitations,
  invoices,
  memberships,
  planEntitlements,
  planPriceVersions,
  plans,
  subscriptions,
  tenants,
  usageCounters,
  type InvoiceLine,
  type SubscriptionStatus,
} from '../schema/index.js';
import { writeAudit, writeSystemAudit, type Actor } from './audit.js';

type Ctx = { tenantId: string; userId: string };

export class BillingError extends Error {
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'UNKNOWN_PLAN'
      | 'SAME_PLAN'
      | 'DOWNGRADE_BLOCKED'
      | 'NO_SUBSCRIPTION'
      | 'UNKNOWN_REFERENCE',
    readonly blockers: DowngradeBlocker[] = [],
  ) {
    super(code);
    this.name = 'BillingError';
  }
}

/* ---- Plan catalogue ------------------------------------------------------------------------------ */

export interface PlanInfo {
  id: string;
  name: string;
  priceMonthlyOre: number;
  sortOrder: number;
  entitlements: Entitlements;
}

/**
 * The monthly price (ex. VAT) a subscription is charged for a period starting `at`. Moves the
 * subscription to a newer version when "Alle fra næste fornyelse" applies, and logs it.
 */
async function priceForRenewal(
  tx: Transaction,
  tenantId: string,
  sub: { id: string; planId: string; priceVersionId: string | null },
  planPriceOre: number,
  at: Date,
): Promise<number> {
  const res = await tx.execute<{ id: string | null }>(
    sql`select app.subscription_version_at(${sub.priceVersionId}::uuid, ${sub.planId}, ${at}) as id`,
  );
  const versionId = res.rows[0]?.id ?? sub.priceVersionId;
  if (!versionId) return planPriceOre;
  const [v] = await tx
    .select({ price: planPriceVersions.priceMonthlyOre })
    .from(planPriceVersions)
    .where(eq(planPriceVersions.id, versionId));
  if (!v) return planPriceOre;
  if (versionId !== sub.priceVersionId) {
    await tx
      .update(subscriptions)
      .set({ priceVersionId: versionId, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
    await writeSystemAudit(tx, tenantId, {
      action: 'subscription.price_changed',
      objectType: 'subscription',
      objectId: sub.id,
      after: { priceVersionId: versionId, priceMonthlyOre: v.price },
    });
  }
  return v.price;
}

async function versionPrice(
  tx: Transaction,
  versionId: string | null,
  fallbackOre: number,
): Promise<number> {
  if (!versionId) return fallbackOre;
  const [v] = await tx
    .select({ price: planPriceVersions.priceMonthlyOre })
    .from(planPriceVersions)
    .where(eq(planPriceVersions.id, versionId));
  return v?.price ?? fallbackOre;
}

async function loadPlans(tx: Transaction): Promise<PlanInfo[]> {
  const rows = await tx.select().from(plans).orderBy(asc(plans.sortOrder));
  const ents = await tx.select().from(planEntitlements);
  return rows.map((p) => ({
    ...p,
    entitlements: parseEntitlements(ents.filter((e) => e.planId === p.id)),
  }));
}

/** For other repositories working inside a transaction. */
export const loadPlansTx = loadPlans;

export function listPlans(db: Database): Promise<PlanInfo[]> {
  return withoutTenant(db, loadPlans);
}

/* ---- Overview (D13, secondary-bar meter) --------------------------------------------------------- */

export interface UsageSnapshot extends CurrentUsage {
  externalUsers: number;
}

async function currentUsage(tx: Transaction, period: string): Promise<UsageSnapshot> {
  const [seatRow] = await tx
    .select({
      seats: sql<number>`count(*)::int`,
      external: sql<number>`count(*) filter (where ${memberships.isExternal})::int`,
    })
    .from(memberships);
  // An integration set is one flow with up to N destinations (D2). Routes arrive with the flow
  // model (M6); until then a flow counts as one set and destinations are not yet counted.
  const [flowRow] = await tx.select({ n: count() }).from(flows);
  const [usageRow] = await tx
    .select({ n: usageCounters.transactions })
    .from(usageCounters)
    .where(eq(usageCounters.period, period));
  return {
    seats: seatRow?.seats ?? 0,
    externalUsers: seatRow?.external ?? 0,
    integrationSets: flowRow?.n ?? 0,
    maxDestinationsInFlow: 0,
    transactionsThisMonth: usageRow?.n ?? 0,
  };
}

export interface BillingOverview {
  subscription: {
    status: SubscriptionStatus;
    hasCard: boolean;
    cardBrand: string | null;
    cardLast4: string | null;
    cardExpiry: string | null;
    currentPeriodEnd: Date | null;
    pastDueSince: Date | null;
    interval: 'month' | 'year';
  };
  plan: PlanInfo;
  plans: PlanInfo[];
  period: string;
  usage: UsageSnapshot;
  quota: QuotaState;
  /** Per plan id: why the tenant can't switch to it (empty = allowed). */
  blockers: Record<string, DowngradeBlocker[]>;
}

export async function getBillingOverview(
  db: Database,
  ctx: Ctx,
  now = new Date(),
): Promise<BillingOverview | null> {
  return withTenant(db, ctx, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) return null;
    const [tenant] = await tx.select({ timeZone: tenants.timeZone }).from(tenants).limit(1);
    const period = billingPeriod(now, tenant?.timeZone);
    const all = await loadPlans(tx);
    const plan = all.find((p) => p.id === sub.planId);
    if (!plan) throw new BillingError('UNKNOWN_PLAN');
    const usage = await currentUsage(tx, period);
    const [counter] = await tx
      .select({ exceededAt: usageCounters.exceededAt })
      .from(usageCounters)
      .where(eq(usageCounters.period, period));
    const [addonRow] = await tx
      .select({ n: sum(addons.quantity).mapWith(Number) })
      .from(addons)
      .where(and(eq(addons.period, period), eq(addons.kind, 'transactions')));
    const quota = quotaState({
      used: usage.transactionsThisMonth,
      planLimit: plan.entitlements.transactionsPerMonth,
      addonTransactions: addonRow?.n ?? 0,
      exceededAt: counter?.exceededAt ?? null,
      graceDays: plan.entitlements.quotaGraceDays,
      now,
    });
    return {
      subscription: {
        status: sub.status,
        hasCard: !!sub.cardLast4,
        cardBrand: sub.cardBrand,
        cardLast4: sub.cardLast4,
        cardExpiry: sub.cardExpiry,
        currentPeriodEnd: sub.currentPeriodEnd,
        pastDueSince: sub.pastDueSince,
        interval: sub.interval,
      },
      // The customer's own price: the version their subscription is on (A2), not the list price.
      plan: {
        ...plan,
        priceMonthlyOre: await versionPrice(tx, sub.priceVersionId, plan.priceMonthlyOre),
      },
      plans: all,
      period,
      usage,
      quota,
      blockers: Object.fromEntries(
        all.map((p) => [p.id, p.id === plan.id ? [] : planChangeBlockers(p.entitlements, usage)]),
      ),
    };
  });
}

/** Owners only (RLS returns nothing for others). */
export function listInvoices(db: Database, ctx: Ctx) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select()
      .from(invoices)
      .where(ne(invoices.status, 'draft'))
      .orderBy(desc(invoices.periodStart))
      .limit(36),
  );
}

export async function getInvoice(db: Database, ctx: Ctx, id: string) {
  const rows = await withTenant(db, ctx, async (tx) => {
    const inv = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), ne(invoices.status, 'draft')))
      .limit(1);
    const t = await tx.select().from(tenants).limit(1);
    return inv[0] && t[0] ? { invoice: inv[0], tenant: t[0] } : null;
  });
  return rows;
}

/* ---- Seats (D11): every user takes a seat, external users included ------------------------------ */

export interface SeatUsage {
  /** Internal members plus open invitations for internal users. */
  used: number;
  limit: number | null;
}

export async function seatUsageTx(tx: Transaction): Promise<SeatUsage> {
  // Every user takes a seat, external users included (decided by Charlie, 19 Oct 2026).
  const [members] = await tx.select({ n: count() }).from(memberships);
  const [pending] = await tx
    .select({ n: count() })
    .from(invitations)
    .where(
      and(
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  const [sub] = await tx.select({ planId: subscriptions.planId }).from(subscriptions).limit(1);
  const plan = sub ? (await loadPlans(tx)).find((p) => p.id === sub.planId) : undefined;
  return {
    used: (members?.n ?? 0) + (pending?.n ?? 0),
    // No subscription (should not happen after onboarding): fail closed at the smallest plan.
    limit: plan ? plan.entitlements.seats : 0,
  };
}

export function seatUsage(db: Database, ctx: Ctx): Promise<SeatUsage> {
  return withTenant(db, ctx, seatUsageTx);
}

/* ---- Owner actions ------------------------------------------------------------------------------- */

/**
 * Plan change. Upgrades apply at once; a downgrade is refused while the tenant is above the new
 * plan's limits, so nothing is ever deactivated to make it fit (§7.8). Price changes take effect
 * from the next charge.
 */
export async function changePlan(db: Database, actor: Actor, planId: string): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) throw new BillingError('NO_SUBSCRIPTION');
    if (sub.planId === planId) throw new BillingError('SAME_PLAN');
    const all = await loadPlans(tx);
    const target = all.find((p) => p.id === planId);
    if (!target) throw new BillingError('UNKNOWN_PLAN');
    const [tenant] = await tx.select({ timeZone: tenants.timeZone }).from(tenants).limit(1);
    const blockers = planChangeBlockers(
      target.entitlements,
      await currentUsage(tx, billingPeriod(new Date(), tenant?.timeZone)),
    );
    if (blockers.length) throw new BillingError('DOWNGRADE_BLOCKED', blockers);
    const res = await tx
      .update(subscriptions)
      .set({ planId, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
      .returning({ id: subscriptions.id });
    if (!res.length) throw new BillingError('FORBIDDEN');
    await writeAudit(tx, actor, {
      action: 'subscription.plan_changed',
      objectType: 'subscription',
      objectId: sub.id,
      before: { plan: sub.planId },
      after: { plan: planId },
    });
  });
}

/**
 * Monthly or yearly billing (D13 "Skift til årlig"; a year costs 10 months). Owner only (the
 * update policy); it applies from the next renewal, so the current period is untouched.
 */
export async function changeInterval(
  db: Database,
  actor: Actor,
  interval: 'month' | 'year',
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) throw new BillingError('NO_SUBSCRIPTION');
    if (sub.interval === interval) return;
    const res = await tx
      .update(subscriptions)
      .set({ interval, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
      .returning({ id: subscriptions.id });
    if (!res.length) throw new BillingError('FORBIDDEN');
    await writeAudit(tx, actor, {
      action: 'subscription.interval_changed',
      objectType: 'subscription',
      objectId: sub.id,
      before: { interval: sub.interval },
      after: { interval },
    });
  });
}

/** Extra transactions for the current period, added to the next invoice (D2). */
export async function buyTransactionAddon(
  db: Database,
  actor: Actor,
  blocks: number,
): Promise<void> {
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 50) throw new BillingError('FORBIDDEN');
  await withTenant(db, actor, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) throw new BillingError('NO_SUBSCRIPTION');
    const plan = (await loadPlans(tx)).find((p) => p.id === sub.planId);
    if (!plan) throw new BillingError('UNKNOWN_PLAN');
    const [tenant] = await tx.select({ timeZone: tenants.timeZone }).from(tenants).limit(1);
    const quantity = blocks * 1000;
    const [row] = await tx
      .insert(addons)
      .values({
        tenantId: actor.tenantId,
        kind: 'transactions',
        quantity,
        period: billingPeriod(new Date(), tenant?.timeZone),
        priceOre: overagePrice(quantity, plan.entitlements.overagePriceOrePer1000),
      })
      .returning({ id: addons.id });
    await writeAudit(tx, actor, {
      action: 'subscription.addon_bought',
      objectType: 'addon',
      objectId: row?.id,
      after: { quantity },
    });
  });
}

/**
 * Links a QuickPay subscription to this tenant before the customer is sent to the card form.
 * The order id is registered in the private index so the callback can find the tenant without
 * trusting anything in the callback but the signature.
 */
export async function attachPaymentSubscription(
  db: Database,
  actor: Actor,
  orderId: string,
  providerSubscriptionId: string,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) throw new BillingError('NO_SUBSCRIPTION');
    const res = await tx
      .update(subscriptions)
      .set({ providerSubscriptionId, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
      .returning({ id: subscriptions.id });
    if (!res.length) throw new BillingError('FORBIDDEN');
    await tx.execute(sql`select app.register_billing_ref(${orderId}, 'subscription', ${sub.id})`);
    await writeAudit(tx, actor, {
      action: 'subscription.card_requested',
      objectType: 'subscription',
      objectId: sub.id,
    });
  });
}

/** The tenant's QuickPay subscription id, for owners starting a card change. */
export async function getPaymentSubscription(db: Database, ctx: Ctx) {
  const [row] = await withTenant(db, ctx, (tx) =>
    tx
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .limit(1),
  );
  return row ?? null;
}

/* ---- Worker: callbacks and monthly charges ------------------------------------------------------- */

export async function resolveBillingRef(
  db: Database,
  orderId: string,
): Promise<{ tenantId: string; kind: 'subscription' | 'invoice'; refId: string } | null> {
  const res = await db.execute<{ tenant_id: string; kind: string; ref_id: string }>(
    sql`select * from app.resolve_billing_ref(${orderId})`,
  );
  const r = res.rows[0];
  if (!r) return null;
  return { tenantId: r.tenant_id, kind: r.kind as 'subscription' | 'invoice', refId: r.ref_id };
}

export interface CardDetails {
  brand: string | null;
  last4: string | null;
  expiry: string | null;
}

/**
 * Card authorised (or re-authorised) for a subscription. A first authorisation activates the
 * subscription and makes the first month due now, so the scheduler charges it on its next run.
 *
 * During signup (PLAN-SIGNUP §4.2) the subscription stays incomplete and the first period starts
 * now; the caller charges it at once ("I alt i dag") and the company only becomes active when
 * QuickPay's Payment callback confirms that charge. A new card after a failed first charge voids
 * the failed invoice, so the retry is a fresh charge for a period starting now.
 * Returns whether the caller should charge the first period now.
 */
export async function applySubscriptionAuthorized(
  db: Database,
  tenantId: string,
  subscriptionId: string,
  card: CardDetails,
  now = new Date(),
): Promise<{ chargeNow: boolean }> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .limit(1);
    if (!sub) throw new BillingError('UNKNOWN_REFERENCE');
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    const signup = !!t && t.state !== 'active';
    const first = sub.status === 'incomplete';
    const cardFields = {
      cardBrand: card.brand,
      cardLast4: card.last4 && /^\d{4}$/.test(card.last4) ? card.last4 : null,
      cardExpiry: card.expiry,
    };
    if (signup) {
      await tx
        .update(invoices)
        .set({ status: 'void', nextRetryAt: null })
        .where(and(eq(invoices.kind, 'subscription'), eq(invoices.status, 'failed')));
      await tx
        .update(subscriptions)
        .set({ ...cardFields, currentPeriodStart: now, currentPeriodEnd: now, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      await tx.execute(sql`select app.signup_payment_activity()`);
    } else {
      await tx
        .update(subscriptions)
        .set({
          ...cardFields,
          ...(first
            ? { status: 'active' as const, currentPeriodStart: now, currentPeriodEnd: now }
            : {}),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
    }
    await writeSystemAudit(tx, tenantId, {
      action: first
        ? signup
          ? 'subscription.card_authorised'
          : 'subscription.activated'
        : 'subscription.card_changed',
      objectType: 'subscription',
      objectId: sub.id,
      after: { card: card.last4 ? `•••• ${card.last4}` : null },
    });
    return { chargeNow: signup };
  });
}

export async function dueSubscriptions(db: Database, now = new Date()): Promise<string[]> {
  const res = await db.execute<{ due_subscriptions: string }>(
    sql`select * from app.due_subscriptions(${now.toISOString()}::timestamptz)`,
  );
  return res.rows.map((r) => r.due_subscriptions);
}

export interface PendingCharge {
  invoiceId: string;
  number: string;
  orderId: string;
  amountOre: number;
  providerSubscriptionId: string;
  /** True when the invoice already existed: the charge was started before and is resumed. */
  resumed: boolean;
}

const DAY = 86_400_000;

/**
 * Creates (or finds) the subscription invoice for the next period: the plan price for a month or
 * a year (10 months), less an active discount, plus add-ons bought in the last period, with 25 %
 * VAT. Idempotent per period (invoices_period_key), so a scheduler retry never bills twice.
 * A cancelled subscription ends instead of renewing. Invoice payment (EAN) issues the invoice
 * with payment terms and moves the period on; card and MobilePay return a charge to run.
 */
export async function prepareCharge(
  db: Database,
  tenantId: string,
  newOrderId: () => string,
  now = new Date(),
): Promise<PendingCharge | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub?.currentPeriodEnd) return null;
    // The first charge during signup runs on an incomplete subscription (card authorised).
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    const signup = !!t && t.state !== 'active';
    if (signup ? sub.status !== 'incomplete' : sub.status !== 'active' && sub.status !== 'past_due')
      return null;
    const periodStart = sub.currentPeriodEnd;
    if (sub.cancelAt && sub.cancelAt.getTime() <= periodStart.getTime()) {
      await tx
        .update(subscriptions)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      await writeSystemAudit(tx, tenantId, {
        action: 'subscription.ended',
        objectType: 'subscription',
        objectId: sub.id,
      });
      return null;
    }
    const byInvoice = sub.paymentMethod === 'invoice';
    if (!byInvoice && !sub.providerSubscriptionId) return null;
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.kind, 'subscription'), eq(invoices.periodStart, periodStart)))
      .limit(1);
    if (existing) {
      if (byInvoice || existing.status === 'paid' || existing.status === 'void') return null;
      const ref = await tx.execute<{ order_id: string }>(
        sql`select order_id from app.resolve_invoice_order(${existing.id})`,
      );
      const orderId = ref.rows[0]?.order_id;
      if (!orderId) return null;
      return {
        invoiceId: existing.id,
        number: existing.number!,
        orderId,
        amountOre: existing.amountOre + existing.vatOre,
        providerSubscriptionId: sub.providerSubscriptionId!,
        resumed: true,
      };
    }
    const plan = (await loadPlans(tx)).find((p) => p.id === sub.planId);
    if (!plan) throw new BillingError('UNKNOWN_PLAN');
    // A2 price versions: the subscription's own version, or the plan's newest "all from next
    // renewal" version once the customer has had 30 days' notice (app.subscription_version_at).
    const monthlyOre = await priceForRenewal(tx, tenantId, sub, plan.priceMonthlyOre, periodStart);
    const [tenant] = await tx.select({ timeZone: tenants.timeZone }).from(tenants).limit(1);
    const prevPeriod = billingPeriod(new Date(periodStart.getTime() - 1), tenant?.timeZone);
    const [addonRow] = await tx
      .select({ n: sum(addons.priceOre).mapWith(Number) })
      .from(addons)
      .where(eq(addons.period, prevPeriod));
    const fullPrice = subscriptionPriceOre({
      monthlyOre,
      interval: sub.interval,
    });
    const price = subscriptionPriceOre({
      monthlyOre,
      interval: sub.interval,
      discountPct: sub.discountPct,
      discountUntil: sub.discountUntil,
      at: periodStart,
    });
    const lines: InvoiceLine[] =
      price < fullPrice
        ? [{ text: `Rabat ${sub.discountPct} %`, amountOre: price - fullPrice }]
        : [];
    const net = price + (addonRow?.n ?? 0);
    const { vat } = withVat(net);
    const numRes = await tx.execute<{ n: string }>(sql`select app.next_invoice_number() as n`);
    const number = numRes.rows[0]!.n;
    const periodEnd = periodEndFor(periodStart, sub.interval);
    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId,
        number,
        kind: 'subscription',
        periodStart,
        periodEnd,
        description: `${plan.name} · ${sub.interval === 'year' ? 'årlig' : 'månedlig'}`,
        lines,
        amountOre: net,
        vatOre: vat,
        paymentMethod: sub.paymentMethod,
        issuedAt: now,
        dueAt: byInvoice ? new Date(now.getTime() + INVOICE_DUE_DAYS * DAY) : now,
      })
      .returning({ id: invoices.id });
    if (byInvoice) {
      // Paid on terms: the period moves on now; an unpaid invoice shows as overdue on Finans.
      await tx
        .update(subscriptions)
        .set({ currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      await writeSystemAudit(tx, tenantId, {
        action: 'invoice.issued',
        objectType: 'invoice',
        objectId: inv!.id,
        after: { number },
      });
      return null;
    }
    const orderId = newOrderId();
    await tx.execute(sql`select app.register_billing_ref(${orderId}, 'invoice', ${inv!.id})`);
    return {
      invoiceId: inv!.id,
      number,
      orderId,
      amountOre: net + vat,
      providerSubscriptionId: sub.providerSubscriptionId!,
      resumed: false,
    };
  });
}

export interface DueInvoiceJob {
  tenantId: string;
  invoiceId: string;
  job: 'send' | 'retry';
}

/** Approved support invoices to send and failed charges to retry (scheduler). */
export async function dueInvoiceJobs(db: Database, now = new Date()): Promise<DueInvoiceJob[]> {
  const res = await db.execute<{ tenant_id: string; invoice_id: string; job: 'send' | 'retry' }>(
    sql`select * from app.due_invoice_jobs(${now.toISOString()}::timestamptz)`,
  );
  return res.rows.map((r) => ({ tenantId: r.tenant_id, invoiceId: r.invoice_id, job: r.job }));
}

/**
 * Sends an approved support invoice (F5, the 1st at 08:00): it gets its number and is charged on
 * the customer's card or MobilePay, or issued with payment terms when the customer pays by
 * invoice. Returns the charge to run, if any. Safe to retry.
 */
export async function sendSupportInvoice(
  db: Database,
  tenantId: string,
  invoiceId: string,
  newOrderId: () => string,
  now = new Date(),
): Promise<PendingCharge | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!inv || inv.kind !== 'support' || inv.status !== 'draft' || !inv.approvedAt) return null;
    const [sub] = await tx.select().from(subscriptions).limit(1);
    const numRes = await tx.execute<{ n: string }>(sql`select app.next_invoice_number() as n`);
    const number = numRes.rows[0]!.n;
    const byInvoice = inv.paymentMethod === 'invoice' || !sub?.providerSubscriptionId;
    await tx
      .update(invoices)
      .set({
        number,
        status: 'open',
        issuedAt: now,
        paymentMethod: byInvoice ? 'invoice' : inv.paymentMethod,
        dueAt: byInvoice ? new Date(now.getTime() + INVOICE_DUE_DAYS * DAY) : now,
      })
      .where(eq(invoices.id, inv.id));
    await writeSystemAudit(tx, tenantId, {
      action: 'invoice.issued',
      objectType: 'invoice',
      objectId: inv.id,
      after: { number },
    });
    if (byInvoice) return null;
    const orderId = newOrderId();
    await tx.execute(sql`select app.register_billing_ref(${orderId}, 'invoice', ${inv.id})`);
    return {
      invoiceId: inv.id,
      number,
      orderId,
      amountOre: inv.amountOre + inv.vatOre,
      providerSubscriptionId: sub!.providerSubscriptionId!,
      resumed: false,
    };
  });
}

/** A failed card charge whose retry is due: a new QuickPay order for the same invoice. */
export async function prepareRetry(
  db: Database,
  tenantId: string,
  invoiceId: string,
  newOrderId: () => string,
  now = new Date(),
): Promise<PendingCharge | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!inv || inv.status !== 'failed' || !inv.nextRetryAt || inv.nextRetryAt > now) return null;
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub?.providerSubscriptionId) return null;
    // Claimed: the next retry is set again if this attempt fails.
    await tx.update(invoices).set({ nextRetryAt: null }).where(eq(invoices.id, inv.id));
    const orderId = newOrderId();
    await tx.execute(sql`select app.register_billing_ref(${orderId}, 'invoice', ${inv.id})`);
    return {
      invoiceId: inv.id,
      number: inv.number!,
      orderId,
      amountOre: inv.amountOre + inv.vatOre,
      providerSubscriptionId: sub.providerSubscriptionId,
      resumed: false,
    };
  });
}

/**
 * Outcome of a charge (from the synchronous recurring response or the callback). A paid
 * subscription invoice moves the subscription one period on; a failed one marks it past due.
 * Failed charges are retried after 2, 5 and 9 days. Repeated callbacks are no-ops.
 */
export async function applyChargeResult(
  db: Database,
  tenantId: string,
  invoiceId: string,
  result: { accepted: boolean; providerPaymentId: string | null },
  now = new Date(),
): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!inv) throw new BillingError('UNKNOWN_REFERENCE');
    if (inv.status === 'paid') return;
    // The same failure reported twice (sync answer and callback) counts once.
    if (
      !result.accepted &&
      inv.status === 'failed' &&
      inv.providerPaymentId === result.providerPaymentId
    )
      return;
    const [sub] = await tx.select().from(subscriptions).limit(1);
    if (!sub) throw new BillingError('NO_SUBSCRIPTION');
    // A failed first payment during signup is shown on /signup/payment with "Prøv igen"; the
    // 2/5/9-day retries and owner notices are for renewals of active companies (decision 18).
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    const signup = !!t && t.state !== 'active';
    if (signup) await tx.execute(sql`select app.signup_payment_activity()`);
    const attempts = inv.attempts + 1;
    const retry =
      result.accepted || signup ? null : nextRetryAt(inv.issuedAt ?? inv.createdAt, attempts);
    await tx
      .update(invoices)
      .set({
        status: result.accepted ? 'paid' : 'failed',
        providerPaymentId: result.providerPaymentId,
        paidAt: result.accepted ? now : null,
        attempts,
        nextRetryAt: retry,
      })
      .where(eq(invoices.id, inv.id));
    if (inv.kind === 'subscription') {
      if (result.accepted) {
        await tx
          .update(subscriptions)
          .set({
            status: 'active',
            pastDueSince: null,
            currentPeriodStart: inv.periodStart,
            currentPeriodEnd: inv.periodEnd,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));
      } else if (!signup) {
        await tx
          .update(subscriptions)
          .set({ status: 'past_due', pastDueSince: sub.pastDueSince ?? now, updatedAt: now })
          .where(eq(subscriptions.id, sub.id));
      }
    }
    // The owners hear about every failed try, with when it is tried again (README decision 18);
    // a payment that goes through clears the notice. A failed first payment during signup is
    // shown on /signup/payment instead.
    if (result.accepted)
      await tx.execute(sql`
        update notifications set resolved_at = ${now}
         where message_key = 'paymentFailed' and resolved_at is null
           and params ->> 'number' = ${inv.number ?? ''}`);
    else if (!signup)
      await tx.execute(sql`
        insert into notifications (tenant_id, user_id, event, needs_action, message_key, params, href)
        select ${tenantId}::uuid, m.user_id, 'payment_failed', true, 'paymentFailed',
               ${JSON.stringify({
                 number: inv.number ?? '',
                 retry: retry ? 'yes' : 'none',
               })}::jsonb, '/billing'
          from memberships m where m.role = 'owner'`);
    await writeSystemAudit(tx, tenantId, {
      action: result.accepted ? 'invoice.paid' : 'invoice.failed',
      objectType: 'invoice',
      objectId: inv.id,
      after: { number: inv.number, ...(retry ? { retryAt: retry.toISOString() } : {}) },
    });
  });
}
