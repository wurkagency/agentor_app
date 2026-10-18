'use server';

import { acceptInvitation, previewInvitation } from '@agentor/db';
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
    await acceptInvitation(db(), s.user.id, token);
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
 */
export async function createAccountAndAccept(input: unknown): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'generic' };
  const { token, name, password } = parsed.data;
  const preview = await previewInvitation(db(), token);
  if (!preview || preview.state !== 'open') return { ok: false, error: 'INVITATION_CLOSED' };

  const ctx = await auth().$context;
  if (await ctx.internalAdapter.findUserByEmail(preview.email))
    return { ok: false, error: 'EXISTS' };
  const user = await ctx.internalAdapter.createUser(
    { email: preview.email, name, emailVerified: true },
    { method: 'invitation' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  try {
    await acceptInvitation(db(), user.id, token);
  } catch (e) {
    return { ok: false, error: errorCode(e) };
  }
  await auth().api.signInEmail({
    body: { email: preview.email, password },
    headers: await headers(),
  });
  return { ok: true };
}
