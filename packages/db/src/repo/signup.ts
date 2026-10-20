import {
  ORDER_BUCKETS,
  periodEndFor,
  subscriptionPriceOre,
  withVat,
  type OnboardingStep,
  type SignupState,
} from '@agentor/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database } from '../client.js';
import {
  authUsers,
  invoices,
  memberships,
  subscriptions,
  tenants,
  termsAcceptances,
  type TermsDocument,
} from '../schema/index.js';
import { maskIp, writeAudit, type Actor } from './audit.js';
import { loadPlansTx } from './billing.js';

type Ctx = { tenantId: string; userId: string };

export class SignupError extends Error {
  constructor(
    readonly code:
      | 'TENANT_NAME_REQUIRED'
      | 'TENANT_LIMIT'
      | 'SIGNUP_PENDING'
      | 'NOT_PENDING'
      | 'NOT_OWNER'
      | 'UNKNOWN_PLAN'
      | 'INVALID',
  ) {
    super(code);
    this.name = 'SignupError';
  }
}

function errorCode(e: unknown): string {
  return e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
}

/* ---- State for the guards ------------------------------------------------------------------------- */

export interface SignupTenant {
  tenantId: string;
  name: string;
  role: 'owner' | 'admin' | 'developer' | 'reader';
  signupState: SignupState;
  onboardingStep: OnboardingStep | null;
  onboardingSkipped: boolean;
}

/**
 * The company the signup and onboarding guards look at: the session's tenant when the user
 * belongs to it, else the user's own unfinished signup, else their first company.
 */
export async function getSignupTenant(
  db: Database,
  userId: string,
  activeTenantId: string | null,
): Promise<SignupTenant | null> {
  const rows = await withoutTenant(
    db,
    (tx) =>
      tx
        .select({
          tenantId: tenants.id,
          name: tenants.name,
          role: memberships.role,
          signupState: tenants.signupState,
          onboardingStep: tenants.onboardingStep,
          onboardingSkippedAt: tenants.onboardingSkippedAt,
          createdAt: tenants.createdAt,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, userId)),
    userId,
  );
  if (!rows.length) return null;
  const pick =
    rows.find((r) => r.tenantId === activeTenantId) ??
    rows.find((r) => r.role === 'owner' && r.signupState !== 'active') ??
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
  return {
    tenantId: pick.tenantId,
    name: pick.name,
    role: pick.role,
    signupState: pick.signupState as SignupState,
    onboardingStep: pick.onboardingStep as OnboardingStep | null,
    onboardingSkipped: pick.onboardingSkippedAt !== null,
  };
}

/** Marks an account as created by self-service signup (purged after 24 h unless it activates). */
export async function markSignupStarted(db: Database, userId: string): Promise<void> {
  await db
    .update(authUsers)
    .set({ signupStartedAt: sql`coalesce(${authUsers.signupStartedAt}, now())` })
    .where(eq(authUsers.id, userId));
}

/* ---- SU3: company and systems --------------------------------------------------------------------- */

export interface SignupCompany {
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  ordersPerMonth: (typeof ORDER_BUCKETS)[number] | null;
  chosenConnectors: string[];
  locale: 'da' | 'en';
}

/** Creates the company in pending_plan with the user as owner (app.create_tenant). */
export async function createSignupCompany(
  db: Database,
  userId: string,
  billingEmail: string,
  c: SignupCompany,
): Promise<string> {
  try {
    return await withoutTenant(
      db,
      async (tx) => {
        const res = await tx.execute<{ t: string }>(
          sql`select app.create_tenant(${c.name}, ${c.cvr ?? ''}, ${c.addressLine ?? ''}, ${c.postalCode ?? ''}, ${c.city ?? ''}, ${billingEmail}, ${c.locale}, ${'Europe/Copenhagen'}, ${c.ordersPerMonth ?? ''}, ${c.chosenConnectors}::text[]) as t`,
        );
        return res.rows[0]!.t;
      },
      userId,
    );
  } catch (e) {
    const msg = errorCode(e);
    for (const code of ['TENANT_NAME_REQUIRED', 'TENANT_LIMIT', 'SIGNUP_PENDING'] as const)
      if (msg.includes(code)) throw new SignupError(code);
    throw e;
  }
}

/** SU3 again ("Tilbage" from the plan or payment step): the owner corrects company and systems. */
export async function updateSignupCompany(
  db: Database,
  actor: Actor,
  c: SignupCompany,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    if (!t || t.state === 'active') throw new SignupError('NOT_PENDING');
    const [m] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, actor.userId));
    if (m?.role !== 'owner') throw new SignupError('NOT_OWNER');
    await tx
      .update(tenants)
      .set({
        name: c.name.trim(),
        cvr: c.cvr,
        addressLine: c.addressLine,
        postalCode: c.postalCode,
        city: c.city,
        ordersPerMonth: c.ordersPerMonth,
        chosenConnectors: c.chosenConnectors,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, actor.tenantId));
    await writeAudit(tx, actor, {
      action: 'company.updated',
      objectType: 'tenant',
      objectId: actor.tenantId,
      after: { name: c.name, cvr: c.cvr },
    });
  });
}

export interface SignupCompanyView extends SignupCompany {
  signupState: SignupState;
  billingEmail: string | null;
}

export async function getSignupCompany(db: Database, ctx: Ctx): Promise<SignupCompanyView | null> {
  const [t] = await withTenant(db, ctx, (tx) => tx.select().from(tenants).limit(1));
  if (!t) return null;
  return {
    name: t.name,
    cvr: t.cvr,
    addressLine: t.addressLine,
    postalCode: t.postalCode,
    city: t.city,
    ordersPerMonth: (ORDER_BUCKETS as readonly string[]).includes(t.ordersPerMonth ?? '')
      ? (t.ordersPerMonth as SignupCompany['ordersPerMonth'])
      : null,
    chosenConnectors: t.chosenConnectors,
    locale: t.locale === 'en' ? 'en' : 'da',
    signupState: t.signupState as SignupState,
    billingEmail: t.billingEmail,
  };
}

/* ---- SU4: plan and period ------------------------------------------------------------------------- */

/** Saves plan and period and moves the company to pending_payment. Can be repeated from SU5. */
export async function chooseSignupPlan(
  db: Database,
  actor: Actor,
  planId: string,
  interval: 'month' | 'year',
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    if (!t || t.state === 'active') throw new SignupError('NOT_PENDING');
    const plan = (await loadPlansTx(tx)).find((p) => p.id === planId);
    if (!plan) throw new SignupError('UNKNOWN_PLAN');
    const res = await tx
      .update(subscriptions)
      .set({ planId, interval, updatedAt: new Date() })
      .where(eq(subscriptions.status, 'incomplete'))
      .returning({ id: subscriptions.id });
    // The owner-only update policy hides the row from anyone else.
    if (!res.length) throw new SignupError('NOT_OWNER');
    await tx.execute(sql`select app.signup_plan_chosen()`);
    await writeAudit(tx, actor, {
      action: 'signup.plan_chosen',
      objectType: 'subscription',
      objectId: res[0]!.id,
      after: { plan: planId, interval },
    });
  });
}

/* ---- SU5: order summary, terms and payment status --------------------------------------------- */

export interface SignupOrder {
  planId: string;
  planName: string;
  interval: 'month' | 'year';
  /** Amounts in øre. */
  netOre: number;
  vatOre: number;
  totalOre: number;
  /** When the first period would end if paid now. */
  renewsAt: Date;
  companyName: string;
  cvr: string | null;
  billingEmail: string | null;
}

export async function getSignupOrder(
  db: Database,
  ctx: Ctx,
  now = new Date(),
): Promise<SignupOrder | null> {
  return withTenant(db, ctx, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).limit(1);
    const [t] = await tx.select().from(tenants).limit(1);
    if (!sub || !t) return null;
    const plan = (await loadPlansTx(tx)).find((p) => p.id === sub.planId);
    if (!plan) return null;
    const net = subscriptionPriceOre({ monthlyOre: plan.priceMonthlyOre, interval: sub.interval });
    const { vat } = withVat(net);
    return {
      planId: plan.id,
      planName: plan.name,
      interval: sub.interval,
      netOre: net,
      vatOre: vat,
      totalOre: net + vat,
      renewsAt: periodEndFor(now, sub.interval),
      companyName: t.name,
      cvr: t.cvr,
      billingEmail: t.billingEmail,
    };
  });
}

export interface AcceptedDocument {
  document: TermsDocument;
  version: string;
  url: string;
}

/**
 * "Accept af betingelser" (SU5): one row per document with the version shown on agentor.dk, and
 * one audit entry, in the same transaction. Owner only (restrictive policy on the table).
 */
export async function recordTermsAcceptance(
  db: Database,
  actor: Actor,
  docs: readonly AcceptedDocument[],
): Promise<void> {
  if (!docs.length || docs.some((d) => !d.version || d.version.length > 80))
    throw new SignupError('INVALID');
  await withTenant(db, actor, async (tx) => {
    await tx.insert(termsAcceptances).values(
      docs.map((d) => ({
        tenantId: actor.tenantId,
        userId: actor.userId,
        document: d.document,
        version: d.version,
        url: d.url,
        ip: maskIp(actor.ip),
      })),
    );
    await writeAudit(tx, actor, {
      action: 'terms.accepted',
      objectType: 'tenant',
      objectId: actor.tenantId,
      after: Object.fromEntries(docs.map((d) => [d.document, d.version])),
    });
  });
}

/** A payment was started: keeps the clean-up away while it's in flight. */
export async function markSignupPaymentActivity(db: Database, ctx: { tenantId: string }) {
  await withTenant(db, ctx, (tx) => tx.execute(sql`select app.signup_payment_activity()`));
}

export type SignupPaymentStatus =
  /** Nothing tried yet, or the customer came back without paying. */
  | 'idle'
  /** Card authorised or charge started; waiting for QuickPay's callback. */
  | 'waiting'
  | 'failed'
  | 'active';

/** What /signup/payment shows while it waits for QuickPay (polled every 2 s after the return). */
export async function getSignupPaymentStatus(db: Database, ctx: Ctx): Promise<SignupPaymentStatus> {
  return withTenant(db, ctx, async (tx) => {
    const [t] = await tx.select({ state: tenants.signupState }).from(tenants).limit(1);
    if (t?.state === 'active') return 'active';
    const [sub] = await tx
      .select({ last4: subscriptions.cardLast4, end: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .limit(1);
    const [inv] = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.kind, 'subscription'))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    if (inv?.status === 'failed') return 'failed';
    if (inv?.status === 'open' || inv?.status === 'paid') return 'waiting';
    return sub?.end ? 'waiting' : 'idle';
  });
}

/* ---- Worker: activation and clean-up -------------------------------------------------------------- */

/**
 * After a verified Payment callback: if this paid invoice is the company's first, the company
 * becomes active. True only for the call that activated it, so receipts are sent once.
 */
export async function activateSignupIfPaid(
  db: Database,
  tenantId: string,
  invoiceId: string,
): Promise<boolean> {
  return withTenant(db, { tenantId }, async (tx) => {
    const res = await tx.execute<{ ok: boolean }>(
      sql`select app.signup_activate(${invoiceId}::uuid) as ok`,
    );
    return res.rows[0]?.ok === true;
  });
}

/** Whether the company is still in signup (worker: no retries or notices for a first payment). */
export async function isSignupPending(db: Database, tenantId: string): Promise<boolean> {
  const [t] = await withTenant(db, { tenantId }, (tx) =>
    tx.select({ state: tenants.signupState }).from(tenants).limit(1),
  );
  return !!t && t.state !== 'active';
}

export async function signupPurgeCandidates(db: Database, now = new Date()) {
  const res = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from app.signup_purge_candidates(${now.toISOString()}::timestamptz)`,
  );
  return res.rows.map((r) => r.tenant_id);
}

/** The QuickPay subscription to cancel before a purge (null when none was created). */
export async function providerSubscriptionFor(db: Database, tenantId: string) {
  const [s] = await withTenant(db, { tenantId }, (tx) =>
    tx
      .select({ id: subscriptions.providerSubscriptionId })
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, tenantId)))
      .limit(1),
  );
  return s?.id ?? null;
}

export async function purgeSignupTenant(db: Database, tenantId: string, now = new Date()) {
  const res = await db.execute<{ ok: boolean }>(
    sql`select app.signup_purge_tenant(${tenantId}::uuid, ${now.toISOString()}::timestamptz) as ok`,
  );
  return res.rows[0]?.ok === true;
}

export async function purgeSignupUsers(db: Database, now = new Date()): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`select app.signup_purge_users(${now.toISOString()}::timestamptz) as n`,
  );
  return Number(res.rows[0]?.n ?? 0);
}
