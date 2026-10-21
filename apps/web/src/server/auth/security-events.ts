import { mustKeepTwoFactor } from '@agentor/db';
import { db } from '../infra';
import { sendMail } from '../mail';
import { auditOwnChange } from '../profile/owner';

/**
 * Login og sikkerhed on the profile (PR1, D15): Better Auth does the work; this writes every
 * change to the audit log (staff: platform log, customers: their company's log) and tells the old
 * address when the login e-mail changes.
 */

type SessionLike = {
  user: { id: string; name: string; email: string; twoFactorEnabled?: boolean | null };
  session: { activeTenantId?: string | null };
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
  if (path === '/email-otp/change-email') await notifyOldAddress(session.user.email);
}

/** "a•••@nordlys-cykler.dk": enough to recognise, not the whole address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  return `${local[0]}•••@${domain}`;
}

async function notifyOldAddress(oldEmail: string) {
  await sendMail({
    to: oldEmail,
    subject: 'Din login-e-mail hos Agentor er ændret',
    text: `Hej

Login-e-mailen på din Agentor-konto er lige blevet ændret, og den nye adresse er bekræftet med en kode.

Var det ikke dig, så kontakt os med det samme på support@agentor.dk.

Venlig hilsen
Agentor`,
  }).catch((err: unknown) =>
    console.error('e-mail change notice failed', err instanceof Error ? err.message : err),
  );
}

export async function sendEmailChangeCode(email: string, code: string): Promise<void> {
  await sendMail({
    to: email,
    subject: `${code} er din kode til at skifte login-e-mail`,
    text: `Hej

Din kode til at bekræfte din nye login-e-mail hos Agentor er:

${code}

Koden virker i 10 minutter. Har du ikke bedt om at skifte e-mail, kan du se bort fra denne mail.

Venlig hilsen
Agentor`,
  });
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
