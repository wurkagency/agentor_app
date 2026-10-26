import { signupRedirect, type SignupSnapshot, type SignupStep } from '@agentor/core';
import { getSignupTenant, type SignupTenant } from '@agentor/db';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getUserSession, type UserSession } from './auth/session';
import { env, isProduction } from './env';
import { db, redis } from './infra';

/**
 * Signup state on the server (PLAN-SIGNUP §2, §5). Before the e-mail is verified there is no
 * session, only a signed cookie pointing at a short-lived pending signup in Redis: the e-mail,
 * the name and the password hash. The password is set on the account only when the code is
 * confirmed in the same browser, so nobody can pre-register someone else's e-mail with a
 * password they know.
 */

export const SIGNUP_COOKIE = 'agentor_signup';
const PENDING_SECONDS = 15 * 60;
/** "send koden igen om 0:42" on SU2: one code per minute per e-mail. */
export const RESEND_SECONDS = 60;

export interface PendingSignup {
  email: string;
  name: string;
  /** Argon2id hash; null for an e-mail that already has an account (no code is ever valid). */
  passwordHash: string | null;
  /** When the last code was sent (ms). */
  sentAt: number;
}

function mac(nonce: string): string {
  return createHmac('sha256', `signup:${env().BETTER_AUTH_SECRET}`)
    .update(nonce)
    .digest('base64url');
}

const key = (nonce: string) => `agentor:signup:pending:${nonce}`;

export async function createPendingSignup(p: PendingSignup): Promise<void> {
  const nonce = randomBytes(18).toString('base64url');
  await redis().set(key(nonce), JSON.stringify(p), 'EX', PENDING_SECONDS);
  (await cookies()).set(SIGNUP_COOKIE, `${nonce}.${mac(nonce)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: PENDING_SECONDS,
  });
}

async function pendingNonce(): Promise<string | null> {
  const raw = (await cookies()).get(SIGNUP_COOKIE)?.value;
  if (!raw) return null;
  const [nonce, given] = raw.split('.');
  if (!nonce || !given) return null;
  const a = Buffer.from(mac(nonce));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b) ? nonce : null;
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
  const nonce = await pendingNonce();
  if (!nonce) return null;
  const raw = await redis().get(key(nonce));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

export async function updatePendingSignup(p: PendingSignup): Promise<void> {
  const nonce = await pendingNonce();
  if (nonce) await redis().set(key(nonce), JSON.stringify(p), 'EX', PENDING_SECONDS);
}

export async function clearPendingSignup(): Promise<void> {
  const nonce = await pendingNonce();
  if (nonce) await redis().del(key(nonce));
  (await cookies()).delete(SIGNUP_COOKIE);
}

/** Seconds until another code may be sent. */
export function resendWait(p: PendingSignup, now = Date.now()): number {
  return Math.max(0, Math.ceil((p.sentAt + RESEND_SECONDS * 1000 - now) / 1000));
}

export interface SignupContext {
  session: UserSession | null;
  pending: PendingSignup | null;
  tenant: SignupTenant | null;
  snapshot: SignupSnapshot;
}

/** Everything the guard needs, once per request. */
export const getSignupContext = cache(async (): Promise<SignupContext> => {
  const session = await getUserSession();
  const pending = session ? null : await getPendingSignup();
  const tenant = session
    ? await getSignupTenant(db(), session.user.id, session.activeTenantId)
    : null;
  return {
    session,
    pending,
    tenant,
    snapshot: {
      signedIn: !!session,
      pendingEmail: !!pending,
      tenant,
      mfa: !!session?.user.twoFactorEnabled,
    },
  };
});

/**
 * Route guard for /signup/* and /onboarding/*: a visitor who opens a later step too early, or
 * comes back later, lands on their current step; an active company on a signup step goes to /.
 */
export async function requireSignupStep(step: SignupStep): Promise<SignupContext> {
  const ctx = await getSignupContext();
  const s = ctx.session;
  // As in requireAppContext: after Google or Microsoft, an owner or admin with two-step
  // verification confirms it once before onboarding too (B10).
  if (
    s?.user.twoFactorEnabled &&
    s.ssoLogin &&
    !s.mfaVerifiedAt &&
    (ctx.tenant?.role === 'owner' || ctx.tenant?.role === 'admin')
  )
    redirect('/login/mfa?sso=1');
  const target = signupRedirect(step, ctx.snapshot);
  if (target) redirect(target);
  return ctx;
}
