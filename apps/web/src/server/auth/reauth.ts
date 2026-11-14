/**
 * Two-step verification for accounts without a password (Google or Microsoft only, B9/B10).
 * In place of the password, turning it on or off needs a recent sign-in at the identity provider
 * (step-up re-authentication): the session must be at most REAUTH_WINDOW_MS old. Password
 * accounts still confirm with the password (Better Auth `allowPasswordless`).
 */
export const REAUTH_WINDOW_MS = 10 * 60_000;

/** The Better Auth endpoints that change or reveal the second factor. */
export const STEP_UP_PATHS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/view-backup-codes',
]);

export function isRecentSignIn(createdAt: Date | string, now = Date.now()): boolean {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t <= REAUTH_WINDOW_MS && t <= now + 60_000;
}
