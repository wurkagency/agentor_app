'use server';

import {
  acceptInvitation,
  getStaffRole,
  listOwnTenants,
  previewInvitation,
  setSessionTenant,
} from '@agentor/db';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { auth } from '@/server/auth/auth';
import { getUserSession } from '@/server/auth/session';
import { db } from '@/server/infra';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const code of [
    'INVITATION_CLOSED',
    'INVITATION_EMAIL_MISMATCH',
    'ALREADY_MEMBER',
    'INVITATION_NOT_FOUND',
  ]) {
    if (msg.includes(code)) return code;
  }
  console.error('invitation accept failed', msg);
  return 'generic';
}

/** Signed-in user accepts. The database checks token, expiry and that the e-mail matches. */
export async function acceptInvite(token: string): Promise<ActionResult> {
  if (!tokenSchema.safeParse(token).success) return { ok: false, error: 'INVITATION_NOT_FOUND' };
  const s = await getUserSession();
  if (!s) return { ok: false, error: 'generic' };
  try {
    const tenantId = await acceptInvitation(db(), s.user.id, token);
    // Open the company just joined, not the user's first one: its payment step (a company
    // created by Agentor) and the owner's onboarding start from here.
    await setSessionTenant(db(), s.sessionId, tenantId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorCode(e) };
  }
}

const createSchema = z.object({
  token: tokenSchema,
  name: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
});

/**
 * New user from an invitation: the account is created with the invited e-mail (the invitation
 * link proves the address), signed in, and the invitation accepted. Open sign-up stays disabled.
 *
 * An account with that e-mail that belongs to no company and isn't staff is one an earlier attempt
 * left half-made (created, then the accept or sign-in failed): the link proves the address the
 * same way a password-reset link would, so it is finished instead of refused. Anyone with a
 * company or a staff role must sign in to accept.
 */
export async function createAccountAndAccept(
  input: unknown,
): Promise<ActionResult<{ signedIn: boolean }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'generic' };
  const { token, name, password } = parsed.data;
  const preview = await previewInvitation(db(), token);
  if (!preview || preview.state !== 'open') return { ok: false, error: 'INVITATION_CLOSED' };

  const ctx = await auth().$context;
  const hash = await ctx.password.hash(password);
  const existing = await ctx.internalAdapter.findUserByEmail(preview.email, {
    includeAccounts: true,
  });
  let userId: string;
  let created = false;
  try {
    if (existing) {
      userId = existing.user.id;
      const [tenants, staff] = await Promise.all([
        listOwnTenants(db(), userId),
        getStaffRole(db(), userId),
      ]);
      if (tenants.length > 0 || staff) return { ok: false, error: 'EXISTS' };
      await ctx.internalAdapter.updateUser(userId, { name, emailVerified: true });
      if (existing.accounts.some((a) => a.providerId === 'credential'))
        await ctx.internalAdapter.updatePassword(userId, hash);
      else
        await ctx.internalAdapter.linkAccount({
          userId,
          providerId: 'credential',
          accountId: userId,
          password: hash,
        });
      // Whoever had a session on the unfinished account loses it.
      await ctx.internalAdapter.deleteUserSessions(userId);
    } else {
      const user = await ctx.internalAdapter.createUser(
        { email: preview.email, name, emailVerified: true },
        { method: 'invitation' },
      );
      userId = user.id;
      created = true;
      await ctx.internalAdapter.linkAccount({
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hash,
      });
    }
    await acceptInvitation(db(), userId, token);
  } catch (e) {
    // Never leave an account behind that the next attempt would refuse.
    if (created) await ctx.internalAdapter.deleteUser(userId!).catch(() => undefined);
    return { ok: false, error: errorCode(e) };
  }
  try {
    await auth().api.signInEmail({
      body: { email: preview.email, password },
      headers: await headers(),
    });
  } catch (e) {
    // The account and the membership exist; signing in by hand finishes it.
    console.error('invitation sign-in failed', e instanceof Error ? e.message : e);
    return { ok: true, data: { signedIn: false } };
  }
  return { ok: true, data: { signedIn: true } };
}
