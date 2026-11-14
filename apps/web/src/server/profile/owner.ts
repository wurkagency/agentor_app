import { getStaffRole, logStaffEvent, writeAudit, withTenant } from '@agentor/db';
import { clientIp } from '../actor';
import { requireCustomerArea, type AppContext, type UserSession } from '../auth/session';
import { db } from '../infra';
import { requireStaff } from '../platform';

/**
 * Whose profile a request is about: always the signed-in user (README decision 25). Staff use
 * /platform/profile, customers /profile; support access never reaches either for someone else.
 */
export interface ProfileOwner {
  kind: 'staff' | 'customer';
  session: UserSession;
  /** Staff: the role. */
  role?: 'superadmin' | 'supporter';
  /** Customers: the company context (membership role, tenant). */
  app?: AppContext;
}

export async function staffOwner(): Promise<ProfileOwner> {
  const { session, actor } = await requireStaff();
  return { kind: 'staff', session, role: actor.role };
}

export async function customerOwner(): Promise<ProfileOwner> {
  const app = await requireCustomerArea();
  return { kind: 'customer', session: app, app };
}

/** The owner for a server action called from either profile page. */
export async function ownerFor(kind: 'staff' | 'customer'): Promise<ProfileOwner> {
  return kind === 'staff' ? staffOwner() : customerOwner();
}

/**
 * Writes a change to the user's own account to the right audit log: Agentor staff to the
 * platform audit log, customers to their current company's audit log.
 */
export async function auditOwnChange(
  who: { userId: string; name: string; activeTenantId: string | null },
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const role = await getStaffRole(db(), who.userId);
  if (role) {
    await logStaffEvent(db(), { userId: who.userId, name: who.name, role }, action, detail);
    return;
  }
  if (!who.activeTenantId) return;
  const actor = {
    tenantId: who.activeTenantId,
    userId: who.userId,
    name: who.name,
    ip: await clientIp().catch(() => null),
  };
  await withTenant(db(), actor, (tx) =>
    writeAudit(tx, actor, { action, objectType: 'user', objectId: who.userId, after: detail }),
  );
}

export const auditFor = (o: ProfileOwner, action: string, detail: Record<string, unknown> = {}) =>
  auditOwnChange(
    {
      userId: o.session.user.id,
      name: o.session.user.name,
      activeTenantId: o.app?.tenant.tenantId ?? null,
    },
    action,
    detail,
  );
