import {
  getMembership,
  listOwnTenants,
  setSessionTenant,
  tenantRequiresMfa,
  type MembershipContext,
} from '@agentor/db';
import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '../infra';
import { currentSupportView, staffRole } from '../platform';
import { auth, SESSION_ABSOLUTE_SECONDS } from './auth';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  locale: 'da' | 'en';
  twoFactorEnabled: boolean;
}

export interface UserSession {
  sessionId: string;
  token: string;
  activeTenantId: string | null;
  user: SessionUser;
}

export interface AppContext extends UserSession {
  tenant: MembershipContext;
  /** Number of tenants the user belongs to; drives "Skift virksomhed" (PLAN Q33). */
  tenantCount: number;
  /**
   * Set when an Agentor staff member works in the customer's app under a support grant (P4).
   * The role is then Admin for "Se og hjælpe" and Læser for "Kun se"; requireRole() refuses
   * everything that doesn't explicitly allow support (team, billing, settings, connections).
   */
  support?: {
    grantId: string;
    sessionId: string;
    scope: 'view' | 'help';
    caseId: string | null;
    caseRef: string;
    approvedByName: string | null;
    expiresAt: Date;
  };
}

/**
 * The signed-in user, or null. Enforces the 30-day absolute session lifetime on top of Better
 * Auth's 12-hour idle timeout (produktspecifikation §9.5). Cached per request.
 */
export const getUserSession = cache(async (): Promise<UserSession | null> => {
  const h = await headers();
  const result = await auth().api.getSession({ headers: h });
  if (!result) return null;
  const { session, user } = result;
  const ageSeconds = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
  if (ageSeconds > SESSION_ABSOLUTE_SECONDS) {
    await auth()
      .api.revokeSession({ headers: h, body: { token: session.token } })
      .catch(() => undefined);
    return null;
  }
  const u = user as typeof user & { locale?: string; twoFactorEnabled?: boolean | null };
  return {
    sessionId: session.id,
    token: session.token,
    activeTenantId:
      (session as typeof session & { activeTenantId?: string | null }).activeTenantId ?? null,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: u.locale === 'en' ? 'en' : 'da',
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
    },
  };
});

/** Signed-in user or redirect to /login. */
export async function requireUser(): Promise<UserSession> {
  const s = await getUserSession();
  if (!s) redirect('/login');
  return s;
}

/**
 * The request's tenant context, derived only from the authenticated session and re-validated
 * against memberships (produktspecifikation §9.1). Owners and admins must have MFA (§9.5).
 */
export const requireAppContext = cache(async (): Promise<AppContext> => {
  const s = await requireUser();
  const view = await currentSupportView(s);
  if (view === 'expired') redirect('/platform/support/end?expired=1');
  if (view) {
    const { grant } = view;
    return {
      ...s,
      activeTenantId: grant.tenantId,
      tenantCount: 1,
      tenant: {
        tenantId: grant.tenantId,
        tenantName: grant.tenantName,
        userId: s.user.id,
        role: grant.scope === 'help' ? 'admin' : 'reader',
        flowScope: 'all',
        onboardingCompleted: true,
      },
      support: {
        grantId: grant.grantId,
        sessionId: view.sessionId,
        scope: grant.scope,
        caseId: grant.caseId,
        caseRef: grant.caseRef,
        approvedByName: grant.approvedByName,
        expiresAt: grant.expiresAt,
      },
    };
  }
  const own = await listOwnTenants(db(), s.user.id);
  // Agentor staff without a company of their own land in the Platform.
  if (own.length === 0) redirect((await staffRole(s.user.id)) ? '/platform' : '/onboarding');

  let tenantId = s.activeTenantId;
  let membership = tenantId ? await getMembership(db(), tenantId, s.user.id) : null;
  if (!membership) {
    // No (or revoked) tenant on the session: fall back to the first tenant the user belongs to.
    tenantId = own[0]!.tenantId;
    membership = await getMembership(db(), tenantId, s.user.id);
    if (!membership) redirect('/login');
    await setSessionTenant(db(), s.sessionId, tenantId);
  }
  if (!s.user.twoFactorEnabled) {
    const privileged = membership.role === 'owner' || membership.role === 'admin';
    // Owners and admins always; everyone when the tenant requires it ("Kræv totrin for hele teamet").
    if (privileged || (await tenantRequiresMfa(db(), { tenantId: tenantId!, userId: s.user.id }))) {
      redirect('/login/mfa/setup');
    }
  }
  return { ...s, activeTenantId: tenantId, tenant: membership, tenantCount: own.length };
});

export type Role = AppContext['tenant']['role'];

/**
 * Role gate for pages and actions (produktspecifikation §6). Renders app/forbidden.tsx
 * ("Ingen adgang") for signed-in users without the role.
 */
export async function requireRole(
  roles: readonly Role[],
  opts: { support?: boolean } = {},
): Promise<AppContext> {
  const ctx = await requireAppContext();
  if (!roles.includes(ctx.tenant.role)) forbidden();
  // Support may only do what a gate explicitly allows: flows, never team, billing or keys.
  if (ctx.support && !opts.support) forbidden();
  return ctx;
}

/** For pages that only read: support may see them, but nothing that is team, billing or settings. */
export async function requireCustomerArea(): Promise<AppContext> {
  const ctx = await requireAppContext();
  if (ctx.support) forbidden();
  return ctx;
}
