'use server';

import { ORDER_BUCKETS } from '@agentor/core';
import {
  chooseSignupPlan,
  createSignupCompany,
  getSignupOrder,
  getSignupPaymentStatus,
  listPlans,
  markSignupPaymentActivity,
  markSignupStarted,
  recordTermsAcceptance,
  setSessionTenant,
  SignupError,
  updateSignupCompany,
  type Actor,
  type SignupPaymentStatus,
} from '@agentor/db';
import { CATALOGUE } from '@agentor/connectors';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientIp, type ActionResult } from '@/server/actor';
import { auth } from '@/server/auth/auth';
import { redisRateLimitStorage } from '@/server/auth/rate-limit';
import { startCardSetupFor } from '@/server/billing';
import { CVR_RE, cvrProvider, type CvrCompany } from '@/server/cvr';
import { env } from '@/server/env';
import { db } from '@/server/infra';
import { currentTermsForAcceptance, LegalUnavailableError } from '@/server/legal';
import { SSO_PROVIDERS } from '@/server/mock-sso';
import {
  clearPendingSignup,
  createPendingSignup,
  getPendingSignup,
  getSignupContext,
  requireSignupStep,
  resendWait,
  updatePendingSignup,
} from '@/server/signup';
import { sendAlreadyHaveAccount, sendInBackground } from '@/server/signup-mail';

/**
 * Self-service signup, server side (PLAN-SIGNUP §4–§5, S1). Every action re-checks the step with
 * the same guard as the pages, so calling an action out of order changes nothing.
 */

const limit = (key: string, window: number, max: number) =>
  redisRateLimitStorage.consume(key, { window, max });

/** Rate-limit keys never contain the e-mail in clear. */
async function emailKey(email: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(email).digest('base64url').slice(0, 22);
}

/* ---- SU1: account ------------------------------------------------------------------------------- */

const accountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((s) => s.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});

/**
 * "Opret konto". Answers the same, equally fast, whether or not the e-mail has an account
 * ("Har du allerede en konto? Log ind" is on the page; nothing here reveals it). A new e-mail gets
 * a 6-digit code; an existing one gets a "you already have an account" mail and no valid code.
 */
export async function startEmailSignup(input: unknown): Promise<ActionResult> {
  await requireSignupStep('account');
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { name, email, password } = parsed.data;
  const ip = (await clientIp()) ?? 'unknown';
  const ek = await emailKey(email);
  if (!(await limit(`signup:ip:${ip}`, 3600, 20)).allowed)
    return { ok: false, error: 'rateLimited' };
  if (!(await limit(`signup:email:${ek}`, 3600, 5)).allowed)
    return { ok: false, error: 'rateLimited' };

  const ctx = await auth().$context;
  // Hashed in both cases so a new and an existing e-mail take the same time.
  const passwordHash = await ctx.password.hash(password);
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  const verifiedAccount = !!existing?.user.emailVerified;
  if (verifiedAccount) {
    const login = `${env().APP_URL}/login`;
    sendInBackground(sendAlreadyHaveAccount(email, login), 'already-have-account');
  } else {
    if (!existing) {
      const user = await ctx.internalAdapter.createUser(
        { email, name, emailVerified: false },
        { method: 'email-otp' },
      );
      await markSignupStarted(db(), user.id);
    }
    // Better Auth's send endpoint, called from here only (its HTTP path is closed).
    sendInBackground(
      auth()
        .api.sendVerificationOTP({ body: { email, type: 'email-verification' } })
        .then(() => undefined),
      'signup code',
    );
  }
  await createPendingSignup({
    email,
    name,
    passwordHash: verifiedAccount ? null : passwordHash,
    sentAt: Date.now(),
  });
  redirect('/signup/verify');
}

/* ---- SU2: code ---------------------------------------------------------------------------------- */

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/**
 * "Bekræft". A wrong, expired or used code and an e-mail that already had an account all give the
 * same answer. After 5 wrong tries the code is spent and a new one must be sent.
 */
export async function verifySignupCode(input: unknown): Promise<ActionResult> {
  await requireSignupStep('verify');
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'codeInvalid' };
  const pending = await getPendingSignup();
  if (!pending) redirect('/signup');
  const ip = (await clientIp()) ?? 'unknown';
  if (!(await limit(`signup:verify:ip:${ip}`, 900, 10)).allowed)
    return { ok: false, error: 'rateLimited' };
  if (!pending.passwordHash) return { ok: false, error: 'codeInvalid' };
  const ctx = await auth().$context;
  const found = await ctx.internalAdapter.findUserByEmail(pending.email, {
    includeAccounts: true,
  });
  if (!found || found.user.emailVerified) return { ok: false, error: 'codeInvalid' };
  try {
    await auth().api.verifyEmailOTP({
      body: { email: pending.email, otp: parsed.data.code },
      headers: await headers(),
    });
  } catch {
    return { ok: false, error: 'codeInvalid' };
  }
  // Now the e-mail is proven: name and password from this browser's own submission.
  await ctx.internalAdapter.updateUser(found.user.id, { name: pending.name });
  const credential = found.accounts.find((a) => a.providerId === 'credential');
  if (credential) await ctx.internalAdapter.updatePassword(found.user.id, pending.passwordHash);
  else
    await ctx.internalAdapter.linkAccount({
      userId: found.user.id,
      providerId: 'credential',
      accountId: found.user.id,
      password: pending.passwordHash,
    });
  await clearPendingSignup();
  redirect('/signup/company');
}

/** "send koden igen" once the countdown on SU2 is over. Same answer for every e-mail. */
export async function resendSignupCode(): Promise<ActionResult<{ waitSeconds: number }>> {
  await requireSignupStep('verify');
  const pending = await getPendingSignup();
  if (!pending) redirect('/signup');
  const wait = resendWait(pending);
  if (wait > 0) return { ok: true, data: { waitSeconds: wait } };
  const ip = (await clientIp()) ?? 'unknown';
  const ek = await emailKey(pending.email);
  if (
    !(await limit(`signup:resend:ip:${ip}`, 3600, 20)).allowed ||
    !(await limit(`signup:email:${ek}`, 3600, 5)).allowed
  )
    return { ok: false, error: 'rateLimited' };
  if (pending.passwordHash)
    sendInBackground(
      auth()
        .api.sendVerificationOTP({ body: { email: pending.email, type: 'email-verification' } })
        .then(() => undefined),
      'signup code',
    );
  await updatePendingSignup({ ...pending, sentAt: Date.now() });
  return { ok: true, data: { waitSeconds: 60 } };
}

/* ---- SU1: Google and Microsoft --------------------------------------------------------------------- */

const ssoSchema = z.object({
  provider: z.enum(SSO_PROVIDERS),
  from: z.enum(['signup', 'login', 'reauth']),
});

/**
 * Starts sign-in with Google or Microsoft; the browser goes to the returned URL. The provider has
 * verified the e-mail, so /signup/verify is skipped. Where the user lands is decided by the guard.
 */
export async function startSso(input: unknown): Promise<ActionResult<{ url: string }>> {
  const parsed = ssoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const e = env();
  if (e.SSO_MODE === 'off') return { ok: false, error: 'ssoOff' };
  const ip = (await clientIp()) ?? 'unknown';
  if (!(await limit(`sso:ip:${ip}`, 60, 20)).allowed) return { ok: false, error: 'rateLimited' };
  // reauth: a fresh sign-in in place of a password before two-step verification (reauth.ts).
  const from = parsed.data.from;
  const callbackURL =
    from === 'signup' ? '/signup/company' : from === 'reauth' ? '/login/mfa/setup' : '/';
  const errorCallbackURL =
    from === 'signup'
      ? '/signup?sso=failed'
      : from === 'reauth'
        ? '/login/mfa/setup?sso=failed'
        : '/login?sso=failed';
  const h = await headers();
  // The mock identity provider registers under the same ids (generic OAuth = social provider).
  const res = await auth().api.signInSocial({
    body: {
      provider: parsed.data.provider,
      callbackURL,
      newUserCallbackURL: '/signup/company',
      errorCallbackURL,
      disableRedirect: true,
    },
    headers: h,
  });
  if (!res.url) return { ok: false, error: 'ssoFailed' };
  return { ok: true, data: { url: res.url } };
}

/* ---- SU3: company and systems ------------------------------------------------------------------------- */

/** "Fundet" / not found / lookup down. A failed lookup never blocks: the form takes manual entry. */
export async function lookupSignupCvr(cvr: string): Promise<ActionResult<CvrCompany>> {
  const ctx = await requireSignupStep('company');
  const clean = String(cvr).replace(/\s/g, '');
  if (!CVR_RE.test(clean)) return { ok: false, error: 'cvrFormat' };
  if (!(await limit(`cvr:user:${ctx.session!.user.id}`, 3600, 20)).allowed)
    return { ok: false, error: 'rateLimited' };
  try {
    const company = await cvrProvider().lookup(clean);
    if (!company) return { ok: false, error: 'cvrNotFound' };
    return { ok: true, data: company };
  } catch (e) {
    console.error('cvr lookup failed', e instanceof Error ? e.message : e);
    return { ok: false, error: 'cvrUnavailable' };
  }
}

const AVAILABLE = new Set(CATALOGUE.map((c) => c.id));
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s));

const companySchema = z.object({
  name: z.string().trim().min(2).max(160),
  cvr: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || CVR_RE.test(s), 'cvrFormat')
    .transform((s) => (s === '' ? null : s)),
  addressLine: optional(160),
  postalCode: optional(10),
  city: optional(80),
  ordersPerMonth: z.enum(ORDER_BUCKETS).nullable(),
  chosenConnectors: z
    .array(z.string().max(40))
    .max(30)
    .transform((ids) => [...new Set(ids)].filter((id) => AVAILABLE.has(id))),
});

/** "Fortsæt" on SU3: creates the company (pending_plan), or corrects it when coming back. */
export async function saveSignupCompany(input: unknown): Promise<ActionResult> {
  const ctx = await requireSignupStep('company');
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const s = ctx.session!;
  const company = { ...parsed.data, locale: s.user.locale };
  try {
    if (ctx.tenant && ctx.tenant.signupState !== 'active') {
      await updateSignupCompany(db(), await actor(ctx.tenant.tenantId), company);
    } else {
      const tenantId = await createSignupCompany(db(), s.user.id, s.user.email, company);
      await setSessionTenant(db(), s.sessionId, tenantId);
    }
  } catch (e) {
    if (e instanceof SignupError) return { ok: false, error: e.code };
    throw e;
  }
  redirect('/signup/plan');
}

/* ---- SU4: plan and period ------------------------------------------------------------------------------ */

const planSchema = z.object({ planId: z.string().max(40), interval: z.enum(['month', 'year']) });

export async function chooseSignupPlanAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireSignupStep('plan');
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  // Plans are data: the id must exist in the catalogue, nothing is hard-coded here.
  if (!(await listPlans(db())).some((p) => p.id === parsed.data.planId))
    return { ok: false, error: 'UNKNOWN_PLAN' };
  try {
    await chooseSignupPlan(
      db(),
      await actor(ctx.tenant!.tenantId),
      parsed.data.planId,
      parsed.data.interval,
    );
  } catch (e) {
    if (e instanceof SignupError) return { ok: false, error: e.code };
    throw e;
  }
  redirect('/signup/payment');
}

/* ---- SU5: terms and payment ---------------------------------------------------------------------------- */

const paymentSchema = z.object({
  acceptSubscriptionTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
});

/**
 * "Betal … og start". Both boxes must be ticked (checked again here). The acceptance is stored
 * with the versions agentor.dk shows now, then the browser goes to QuickPay's payment window.
 * Card details are typed there and never reach Agentor. Nothing becomes active from this action
 * or from the browser's return: only QuickPay's verified callback activates the company.
 */
export async function startSignupPayment(input: unknown): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireSignupStep('payment');
  if (!paymentSchema.safeParse(input).success) return { ok: false, error: 'termsRequired' };
  const t = ctx.tenant!;
  if (t.role !== 'owner') return { ok: false, error: 'NOT_OWNER' };
  if (!(await limit(`signup:pay:${t.tenantId}`, 3600, 10)).allowed)
    return { ok: false, error: 'rateLimited' };
  const who = await actor(t.tenantId);
  let docs;
  try {
    docs = await currentTermsForAcceptance();
  } catch (e) {
    if (e instanceof LegalUnavailableError) return { ok: false, error: 'termsUnavailable' };
    throw e;
  }
  const order = await getSignupOrder(db(), who);
  if (!order) return { ok: false, error: 'NOT_PENDING' };
  await recordTermsAcceptance(db(), who, docs);
  await markSignupPaymentActivity(db(), who);
  const url = await startCardSetupFor(
    { actor: who, tenantName: t.name, locale: ctx.session!.user.locale },
    { continuePath: '/signup/payment?return=1', cancelPath: '/signup/payment?cancelled=1' },
    order.totalOre,
  );
  return { ok: true, data: { url } };
}

/** Polled by /signup/payment after the return from QuickPay, every 2 s. */
export async function signupPaymentStatus(): Promise<
  ActionResult<{ status: SignupPaymentStatus }>
> {
  const ctx = await getSignupContext();
  if (!ctx.session || !ctx.tenant) return { ok: false, error: 'notSignedIn' };
  const status = await getSignupPaymentStatus(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.session.user.id,
  });
  return { ok: true, data: { status } };
}

async function actor(tenantId: string): Promise<Actor> {
  const ctx = await getSignupContext();
  return {
    tenantId,
    userId: ctx.session!.user.id,
    name: ctx.session!.user.name,
    ip: await clientIp(),
  };
}
