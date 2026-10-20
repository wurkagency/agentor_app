import { uuidv7 } from '@agentor/core';
import { schema } from '@agentor/db';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { hash, verify, type Options as Argon2Options } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, genericOAuth, twoFactor } from 'better-auth/plugins';
import { env, isProduction } from '../env';
import { db } from '../infra';
import { notifyNewDevice } from './new-device';
import { redisRateLimitStorage } from './rate-limit';
import { clearFailures, isLocked, recordFailure } from './lockout';
import { sendMail } from '../mail';
import { markSessionMfaVerified, markSignupStarted, signInMethods } from '@agentor/db';
import { isRecentSignIn, STEP_UP_PATHS } from './reauth';
import { mockSsoConfig, SSO_PROVIDERS } from '../mock-sso';
import { sendSignupCode } from '../signup-mail';

/**
 * Better Auth's e-mail OTP endpoints would sign a user in with just a mailed code, past the
 * password and second factor. They are closed over HTTP; signup calls them only from its own
 * server actions with its own checks (PLAN-SIGNUP §5).
 */
const CLOSED_PATHS = [
  '/email-otp/send-verification-otp',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/sign-in/email-otp',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
];

/** Endpoints that end in a session for a social or mock-IdP sign-in. */
const isSsoCallback = (path: string | undefined) => !!path && path.startsWith('/callback/');

/** Endpoints where the user passed a second factor. */
const SECOND_FACTOR_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/passkey/verify-authentication',
]);

/** Six-digit codes for e-mail signup: 10 minutes, 5 tries, stored hashed (PLAN-SIGNUP §3.7). */
export const SIGNUP_CODE_SECONDS = 600;
export const SIGNUP_CODE_ATTEMPTS = 5;

/** Argon2id (produktspecifikation §9.5); OWASP-recommended parameters. */
const ARGON2: Argon2Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export const SESSION_IDLE_SECONDS = 12 * 3600;
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 3600;

function createAuth() {
  const e = env();
  const appUrl = new URL(e.APP_URL);
  return betterAuth({
    appName: 'Agentor',
    baseURL: e.APP_URL,
    basePath: '/api/auth',
    disabledPaths: CLOSED_PATHS,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl.origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
        twoFactor: schema.authTwoFactors,
        passkey: schema.authPasskeys,
      },
    }),
    advanced: {
      database: { generateId: () => uuidv7() },
      cookiePrefix: 'agentor',
      useSecureCookies: isProduction(),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: isProduction() },
    },
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'da', input: false },
      },
    },
    session: {
      // Idle timeout 12 h: the session slides forward at most once an hour while in use.
      // The 30-day absolute limit is enforced in getSessionContext() (§9.5).
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 3600,
      cookieCache: { enabled: false },
      additionalFields: {
        activeTenantId: { type: 'string', required: false, input: false },
        ssoLogin: { type: 'boolean', required: false, defaultValue: false, input: false },
        mfaVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Accounts are created through /signup (M4) and invitations (M3), both via server
      // actions with their own checks; Better Auth's public sign-up endpoint stays closed.
      disableSignUp: true,
      // A new account must confirm its e-mail before it can sign in (§9.5).
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: h, password }) => verify(h, password, ARGON2),
      },
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Nulstil din adgangskode til Agentor',
          text: `Hej ${user.name}\n\nBrug linket herunder til at vælge en ny adgangskode. Linket virker i 1 time.\n\n${url}\n\nHar du ikke bedt om det, kan du se bort fra denne mail.\n\nVenlig hilsen\nAgentor`,
        });
      },
    },
    ...(e.SSO_MODE === 'live'
      ? {
          socialProviders: {
            ...(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
              ? {
                  google: {
                    clientId: e.GOOGLE_CLIENT_ID,
                    clientSecret: e.GOOGLE_CLIENT_SECRET,
                    prompt: 'select_account' as const,
                  },
                }
              : {}),
            ...(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET
              ? {
                  microsoft: {
                    clientId: e.MICROSOFT_CLIENT_ID,
                    clientSecret: e.MICROSOFT_CLIENT_SECRET,
                    tenantId: 'common',
                    prompt: 'select_account' as const,
                  },
                }
              : {}),
          },
        }
      : {}),
    account: {
      // The provider has verified the e-mail; link it to an existing account with that e-mail.
      // An account from an unfinished e-mail signup has no password yet (it is set when the code
      // is confirmed), so linking can't hand someone else's password a Google login.
      accountLinking: { enabled: true, trustedProviders: [...SSO_PROVIDERS] },
    },
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Bekræft din e-mail til Agentor',
          text: `Hej ${user.name}

Bekræft din e-mail for at komme i gang med Agentor. Linket virker i 24 timer.

${url}

Har du ikke oprettet en konto, kan du se bort fra denne mail.

Venlig hilsen
Agentor`,
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Per IP. Offices share an IP, so this is generous; per-account lockout catches guessing.
        '/sign-in/email': { window: 60, max: 20 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/send-verification-email': { window: 300, max: 3 },
        '/sign-in/social': { window: 60, max: 20 },
      },
      customStorage: redisRateLimitStorage,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (STEP_UP_PATHS.has(ctx.path)) {
          const s = await getSessionFromCtx(ctx);
          if (s) {
            const methods = await signInMethods(db(), s.user.id);
            if (!methods.password && !isRecentSignIn(s.session.createdAt))
              throw new APIError('FORBIDDEN', {
                message: 'REAUTH_REQUIRED',
                code: 'REAUTH_REQUIRED',
              });
          }
        }
        if (ctx.path === '/sign-in/email') {
          const email = String(
            (ctx.body as { email?: unknown } | undefined)?.email ?? '',
          ).toLowerCase();
          if (email && (await isLocked(email))) {
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'ACCOUNT_LOCKED',
              code: 'ACCOUNT_LOCKED',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email') {
          const email = String(
            (ctx.body as { email?: unknown } | undefined)?.email ?? '',
          ).toLowerCase();
          if (!email) return;
          if (ctx.context.returned instanceof APIError) await recordFailure(email);
          else await clearFailures(email);
        }
        // A second factor confirmed on an existing session (after a Google or Microsoft login).
        if (
          SECOND_FACTOR_PATHS.has(ctx.path) &&
          !(ctx.context.returned instanceof APIError) &&
          !ctx.context.newSession &&
          ctx.context.session
        ) {
          await markSessionMfaVerified(db(), ctx.context.session.session.id);
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            // A new account from Google or Microsoft is a signup: purged after 24 h unless its
            // company becomes active (B1). E-mail signups are marked by their own action.
            if (isSsoCallback(ctx?.path)) await markSignupStarted(db(), user.id);
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => ({
            data: {
              ...session,
              ssoLogin: isSsoCallback(ctx?.path),
              mfaVerifiedAt: ctx?.path && SECOND_FACTOR_PATHS.has(ctx.path) ? new Date() : null,
            },
          }),
          after: async (session) => {
            // Fire and forget: a mail outage must never block a login.
            void notifyNewDevice(session).catch((err: unknown) => {
              console.error(
                'new-device notification failed',
                err instanceof Error ? err.message : err,
              );
            });
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Agentor',
        // 8 codes (D12-Sikkerhed), stored encrypted rather than as plain JSON.
        backupCodeOptions: { amount: 8, storeBackupCodes: 'encrypted' },
        trustDeviceMaxAge: 30 * 24 * 3600, // "Husk denne enhed i 30 dage" (D14-MFA)
        // Google/Microsoft-only accounts have no password; the before-hook asks for a recent
        // sign-in instead. Accounts with a password still confirm with it.
        allowPasswordless: true,
      }),
      passkey({ rpID: appUrl.hostname, rpName: 'Agentor', origin: appUrl.origin }),
      emailOTP({
        otpLength: 6,
        expiresIn: SIGNUP_CODE_SECONDS,
        allowedAttempts: SIGNUP_CODE_ATTEMPTS,
        storeOTP: 'hashed',
        disableSignUp: true,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === 'email-verification') await sendSignupCode(email, otp);
        },
      }),
      // Always registered (typed API); providers only in mock mode.
      genericOAuth({ config: e.SSO_MODE === 'mock' ? mockSsoConfig(e.APP_URL) : [] }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __agentorAuth?: Auth };

/** Lazily created so `next build` doesn't need runtime secrets. */
export function auth(): Auth {
  g.__agentorAuth ??= createAuth();
  return g.__agentorAuth;
}
