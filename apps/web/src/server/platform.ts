import {
  activeGrant,
  getStaffRole,
  touchSession,
  type MyGrant,
  type StaffActor,
} from '@agentor/db';

import { cookies, headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { requireUser, type UserSession } from './auth/session';
import { db } from './infra';

type StaffRole = StaffActor['role'];

/**
 * Agentor Platform (README decisions 16–17). Staff are ordinary Agentor logins with a row in
 * platform.staff; they need two-step login, and they reach customer data only through a support
 * grant, which the database checks again on every query (app.support_scope()).
 */

/** The support view in progress: "<grantId>.<sessionId>", httpOnly, this browser only. */
export const SUPPORT_COOKIE = 'agentor_support';

export const staffRole = cache(async (userId: string): Promise<StaffRole | null> =>
  getStaffRole(db(), userId),
);

export interface StaffContext {
  session: UserSession;
  actor: StaffActor;
}

/** Staff gate for /platform. Superadmin-only pages pass superadmin: true. */
export const requireStaff = cache(async (superadmin = false): Promise<StaffContext> => {
  const session = await requireUser();
  const role = await staffRole(session.user.id);
  if (!role) forbidden();
  if (!session.user.twoFactorEnabled) redirect('/login/mfa/setup');
  if (superadmin && role !== 'superadmin') forbidden();
  return { session, actor: { userId: session.user.id, name: session.user.name, role } };
});

export interface SupportView {
  grant: MyGrant;
  sessionId: string;
}

/**
 * The support view behind the cookie, if it still holds: the user is staff, the grant is theirs,
 * approved and unexpired. Records the request in the session's activity (S5).
 */
export const currentSupportView = cache(
  async (session: UserSession): Promise<SupportView | null | 'expired'> => {
    const raw = (await cookies()).get(SUPPORT_COOKIE)?.value;
    if (!raw) return null;
    const [grantId, sessionId] = raw.split('.');
    if (!grantId || !sessionId) return 'expired';
    if (!(await staffRole(session.user.id))) return 'expired';
    const grant = await activeGrant(db(), session.user.id, grantId);
    if (!grant) return 'expired';
    const path = (await headers()).get('x-pathname') ?? '';
    if (path && !path.startsWith('/_next')) {
      await touchSession(db(), session.user.id, sessionId, path).catch(() => undefined);
    }
    return { grant, sessionId };
  },
);
