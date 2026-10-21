import { mustKeepTwoFactor } from '@agentor/db';
import { db } from '../infra';
import { maskAddress } from '@agentor/email';
import { sendEmail } from '../mail';
import { describeAgent } from './new-device';
import { auditOwnChange } from '../profile/owner';

/**
 * Login og sikkerhed on the profile (PR1, D15): Better Auth does the work; this writes every
 * change to the audit log (staff: platform log, customers: their company's log) and tells the old
 * address when the login e-mail changes.
 */

type SessionLike = {
  user: { id: string; name: string; email: string; twoFactorEnabled?: boolean | null };
  session: { activeTenantId?: string | null; userAgent?: string | null };
};

/** Better Auth path → audit action, for successful calls on an existing session. */
const EVENTS: Record<string, string> = {
  '/change-password': 'security.password_changed',
  '/two-factor/disable': 'security.two_factor_disabled',
  '/two-factor/generate-backup-codes': 'security.backup_codes_generated',
  '/passkey/verify-registration': 'security.passkey_added',
  '/passkey/delete-passkey': 'security.passkey_removed',
  '/revoke-other-sessions': 'session.revoked',
  '/revoke-sessions': 'session.revoked',
  '/revoke-session': 'session.revoked',
  '/email-otp/change-email': 'security.email_changed',
};

export async function auditSecurityEvent(
  path: string,
  session: SessionLike | null | undefined,
  body: unknown,
  newSession: boolean,
): Promise<void> {
  if (!session) return;
  void newSession;
  const action = EVENTS[path];
  if (!action) return;
  const b = (body ?? {}) as Record<string, unknown>;
  const detail: Record<string, unknown> =
    path === '/change-password'
      ? { revokedOtherSessions: Boolean(b.revokeOtherSessions) }
      : path === '/email-otp/change-email'
        ? { from: maskEmail(session.user.email), to: maskEmail(String(b.newEmail ?? '')) }
        : {};
  await auditOwnChange(
    {
      userId: session.user.id,
      name: session.user.name,
      activeTenantId: session.session.activeTenantId ?? null,
    },
    action,
    detail,
  );
  if (path === '/email-otp/change-email')
    await notifyOldAddress(
      session.user.email,
      String(b.newEmail ?? ''),
      session.session.userAgent ?? null,
    );
}

/** "a•••@nordlys-cykler.dk": enough to recognise, not the whole address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  return `${local[0]}•••@${domain}`;
}

/** E05: to the old address. No button and no link; the new address is masked. */
async function notifyOldAddress(oldEmail: string, newEmail: string, userAgent: string | null) {
  await sendEmail(
    'email-changed',
    {
      email: oldEmail,
      newEmailMasked: maskAddress(newEmail),
      at: new Date(),
      device: userAgent ? describeAgent(userAgent) : null,
    },
    { to: oldEmail },
  ).catch((err: unknown) =>
    console.error('e-mail change notice failed', err instanceof Error ? err.message : err),
  );
}

/** E04: the code to the new address (10 minutes), code first in the subject. */
export async function sendEmailChangeCode(email: string, code: string): Promise<void> {
  await sendEmail('email-change-code', { code, email }, { to: email });
}

/** Staff, and members of a company that requires it, can't turn TOTP off (D12, PLAN Q9). */
export const twoFactorRequired = (userId: string) => mustKeepTwoFactor(db(), userId);

/**
 * Turning TOTP on: Better Auth sets two_factor_enabled when the first code is verified, and starts
 * a new session doing so, so the change is caught on the user row instead.
 */
export async function auditTwoFactorEnabled(
  user: { id: string; name: string; twoFactorEnabled?: boolean | null },
  path: string | undefined,
  activeTenantId: string | null,
): Promise<void> {
  if (path !== '/two-factor/verify-totp' || !user.twoFactorEnabled) return;
  await auditOwnChange(
    { userId: user.id, name: user.name, activeTenantId },
    'security.two_factor_enabled',
  );
}
