import { uuidv7 } from '@agentor/core';
import { schema } from '@agentor/db';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { hash, verify, type Options as Argon2Options } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { env, isProduction } from '../env';
import { db } from '../infra';
import { notifyNewDevice } from './new-device';
import { redisRateLimitStorage } from './rate-limit';
import { clearFailures, isLocked, recordFailure } from './lockout';
import { sendMail } from '../mail';

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
      },
    },
    emailAndPassword: {
      enabled: true,
      // Accounts are created through invitations (M3) and onboarding (M4), not open sign-up.
      disableSignUp: true,
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
      },
      customStorage: redisRateLimitStorage,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
      }),
    },
    databaseHooks: {
      session: {
        create: {
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
      }),
      passkey({ rpID: appUrl.hostname, rpName: 'Agentor', origin: appUrl.origin }),
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
