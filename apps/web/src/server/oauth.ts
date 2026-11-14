import { manifestFor } from '@agentor/connectors';
import { activeGrant, getMembership } from '@agentor/db';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, redis } from './infra';
import { staffRole } from './platform';

/**
 * Connecting a system with OAuth (PLAN-SIGNUP B11). The start route stores who is connecting what
 * and where to return, under an unguessable state token; the callback resolves everything from
 * that token, not from the browser's cookie. That is what makes it work when the provider opens in
 * the phone's system browser, which on iOS doesn't share cookies with the installed app.
 *
 * Provider part (client ids, token exchange, scopes per system) is FOLLOW-UP T1; until then
 * CONNECTOR_MODE=mock and the app's own consent page stands in for the provider.
 */

const TTL_SECONDS = 600;
const key = (token: string) => `agentor:oauth:state:${token}`;

const stateSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  userName: z.string().max(200),
  connectorId: z.string().max(40),
  returnTo: z.string().max(300),
  baseUrl: z.string().max(300).nullable(),
  reconnectId: z.uuid().nullable(),
  /** Started by Agentor support in the customer's app: the help grant it ran under. */
  supportGrantId: z.uuid().nullable().default(null),
});
export type OAuthState = z.infer<typeof stateSchema>;

const MANAGERS = new Set(['owner', 'admin', 'developer']);

/**
 * May the one who started this connect the system now? A member with a managing role in an
 * active company, or Agentor staff whose help grant for that company still holds. Checked again
 * at the callback, so a revoked grant or role stops a login that is under way.
 */
export async function mayConnect(
  s: Pick<OAuthState, 'tenantId' | 'userId' | 'supportGrantId'>,
): Promise<boolean> {
  if (s.supportGrantId) {
    if (!(await staffRole(s.userId))) return false;
    const grant = await activeGrant(db(), s.userId, s.supportGrantId);
    return !!grant && grant.tenantId === s.tenantId && grant.scope === 'help';
  }
  const membership = await getMembership(db(), s.tenantId, s.userId);
  return !!membership && MANAGERS.has(membership.role) && membership.signupState === 'active';
}

/** Where a connection may return to: onboarding steps and the connection pages. */
export function safeReturn(path: string | null | undefined): string {
  if (!path || !/^\/(onboarding|connections)(\/[a-z0-9/-]*)?$/.test(path)) return '/connections';
  return path;
}

export async function createOAuthState(s: OAuthState): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await redis().set(key(token), JSON.stringify(stateSchema.parse(s)), 'EX', TTL_SECONDS);
  return token;
}

/** One use only. */
export async function takeOAuthState(token: string | null): Promise<OAuthState | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const raw = await redis().getdel(key(token));
  if (!raw) return null;
  const parsed = stateSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function peekOAuthState(token: string | null): Promise<OAuthState | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const raw = await redis().get(key(token));
  if (!raw) return null;
  const parsed = stateSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/**
 * Mock credentials in the shape the connector's manifest expects, so the rest of the system (key
 * box, worker, engine) runs exactly as with a real login. Dummy data until T1.
 */
export function mockCredentials(
  connectorId: string,
  baseUrl: string | null,
): Record<string, string> {
  const m = manifestFor(connectorId);
  const r = () => `mock-${randomBytes(12).toString('hex')}`;
  if (!m || m.auth.type === 'oauth2') return { accessToken: r(), refreshToken: r() };
  const creds: Record<string, string> = {};
  for (const f of m.auth.fields)
    creds[f.key] = f.type === 'url' ? (baseUrl ?? 'https://example.test') : r();
  return creds;
}
