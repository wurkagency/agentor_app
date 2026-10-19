import { and, asc, eq, ne } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database } from '../client.js';
import {
  authSessions,
  authUsers,
  memberships,
  tenants,
  type MembershipRole,
} from '../schema/index.js';

export interface OwnTenant {
  tenantId: string;
  name: string;
  role: MembershipRole;
}

/**
 * Tenants the user belongs to, before a tenant is chosen. Relies on the
 * own_memberships_without_tenant / own_tenants_without_tenant policies (ADR 0004).
 */
export async function listOwnTenants(db: Database, userId: string): Promise<OwnTenant[]> {
  return withoutTenant(
    db,
    (tx) =>
      tx
        .select({ tenantId: tenants.id, name: tenants.name, role: memberships.role })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(tenants.name)),
    userId,
  );
}

export interface MembershipContext {
  tenantId: string;
  tenantName: string;
  userId: string;
  role: MembershipRole;
  flowScope: 'all' | 'selected';
  /** False until the owner has finished /onboarding (D14). */
  onboardingCompleted: boolean;
}

/** The user's membership in a tenant, or null. The tenant comes from the session, never input. */
export async function getMembership(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<MembershipContext | null> {
  const rows = await withTenant(db, { tenantId, userId }, (tx) =>
    tx
      .select({
        tenantId: memberships.tenantId,
        tenantName: tenants.name,
        role: memberships.role,
        flowScope: memberships.flowScope,
        onboardingCompletedAt: tenants.onboardingCompletedAt,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  const { onboardingCompletedAt, ...rest } = row;
  return { ...rest, userId, onboardingCompleted: onboardingCompletedAt !== null };
}

/** Stores the tenant a session works in. Only called after getMembership() confirmed access. */
export async function setSessionTenant(
  db: Database,
  sessionId: string,
  tenantId: string | null,
): Promise<void> {
  await db
    .update(authSessions)
    .set({ activeTenantId: tenantId, updatedAt: new Date() })
    .where(eq(authSessions.id, sessionId));
}

/** True if the user has signed in before from this user agent (new-device notification). */
export async function hasEarlierSessionFromAgent(
  db: Database,
  userId: string,
  userAgent: string,
  excludeSessionId: string,
): Promise<{ seenAgent: boolean; anyEarlier: boolean }> {
  const rows = await db
    .select({ userAgent: authSessions.userAgent })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), ne(authSessions.id, excludeSessionId)));
  return { seenAgent: rows.some((r) => r.userAgent === userAgent), anyEarlier: rows.length > 0 };
}

export async function setUserLocale(
  db: Database,
  userId: string,
  locale: 'da' | 'en',
): Promise<void> {
  await db.update(authUsers).set({ locale, updatedAt: new Date() }).where(eq(authUsers.id, userId));
}

export async function getUserById(db: Database, userId: string) {
  const rows = await db
    .select({
      id: authUsers.id,
      name: authUsers.name,
      email: authUsers.email,
      locale: authUsers.locale,
      twoFactorEnabled: authUsers.twoFactorEnabled,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  return rows[0] ?? null;
}
