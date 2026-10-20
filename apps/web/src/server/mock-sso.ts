import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GenericOAuthConfig } from 'better-auth/plugins';
import { z } from 'zod';
import { env, isProduction } from './env';

/** Providers on SU1/MS1 (and /login, B10). */
export const SSO_PROVIDERS = ['google', 'microsoft'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

/**
 * A local stand-in for Google and Microsoft (SSO_MODE=mock, e2e and development). It speaks
 * OAuth 2.0 with PKCE like the real ones, through Better Auth's generic OAuth plugin, so the
 * whole redirect, code exchange and account creation run as in production. Never in production.
 */
export function mockSsoEnabled(): boolean {
  return env().SSO_MODE === 'mock' && !isProduction();
}

export function mockSsoConfig(appUrl: string): GenericOAuthConfig[] {
  if (isProduction()) throw new Error('SSO_MODE=mock is not allowed in production');
  return SSO_PROVIDERS.map((providerId) => ({
    providerId,
    clientId: `mock-${providerId}`,
    clientSecret: 'mock-secret',
    authorizationUrl: new URL(`/dev/oauth/authorize?provider=${providerId}`, appUrl).toString(),
    tokenUrl: new URL('/dev/oauth/token', appUrl).toString(),
    userInfoUrl: new URL('/dev/oauth/userinfo', appUrl).toString(),
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
  }));
}

const identity = z.object({
  provider: z.enum(SSO_PROVIDERS),
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  /** Expiry, ms since epoch. */
  exp: z.number().int(),
});
export type MockIdentity = z.infer<typeof identity>;

function sign(payload: string): string {
  return createHmac('sha256', `mock-sso:${env().BETTER_AUTH_SECRET}`)
    .update(payload)
    .digest('base64url');
}

/** Code and access token are the same signed, short-lived identity. */
export function encodeMockToken(i: Omit<MockIdentity, 'exp'>): string {
  const payload = Buffer.from(JSON.stringify({ ...i, exp: Date.now() + 5 * 60_000 })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function decodeMockToken(token: string | null | undefined): MockIdentity | null {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = identity.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (!parsed.success || parsed.data.exp < Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
