'use server';

import {
  decideSupportGrant,
  revokeOtherSessions,
  revokeUserSession,
  setTenantSecurity,
  writeAudit,
  withTenant,
} from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireCustomerArea, requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';

export async function logoutOtherSessions(): Promise<ActionResult<{ count: number }>> {
  const ctx = await requireCustomerArea();
  const count = await revokeOtherSessions(db(), ctx.user.id, ctx.sessionId);
  const actor = await actorFor(ctx);
  await withTenant(db(), actor, (tx) =>
    writeAudit(tx, actor, { action: 'session.revoked', objectType: 'session', after: { count } }),
  );
  revalidatePath('/settings/security');
  return { ok: true, data: { count } };
}

export async function logoutSession(sessionId: string): Promise<ActionResult> {
  const ctx = await requireCustomerArea();
  if (!z.uuid().safeParse(sessionId).success || sessionId === ctx.sessionId)
    return { ok: false, error: 'NOT_FOUND' };
  // Scoped to the signed-in user: you can only end your own sessions.
  const ok = await revokeUserSession(db(), ctx.user.id, sessionId);
  if (!ok) return { ok: false, error: 'NOT_FOUND' };
  const actor = await actorFor(ctx);
  await withTenant(db(), actor, (tx) =>
    writeAudit(tx, actor, {
      action: 'session.revoked',
      objectType: 'session',
      objectId: sessionId,
    }),
  );
  revalidatePath('/settings/security');
  return { ok: true };
}

export async function setSecurity(input: unknown): Promise<ActionResult> {
  const ctx = await requireRole(['owner', 'admin']);
  const parsed = z
    .object({
      requireMfaAll: z.boolean().optional(),
      supportRequiresApproval: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  await setTenantSecurity(db(), await actorFor(ctx), parsed.data);
  revalidatePath('/settings/security');
  return { ok: true };
}

export async function decideSupport(
  grantId: string,
  decision: 'approve' | 'deny' | 'revoke',
): Promise<ActionResult> {
  const ctx = await requireRole(['owner', 'admin']);
  if (!z.uuid().safeParse(grantId).success || !['approve', 'deny', 'revoke'].includes(decision)) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  try {
    await decideSupportGrant(db(), await actorFor(ctx), grantId, decision);
  } catch {
    return { ok: false, error: 'NOT_FOUND' };
  }
  revalidatePath('/settings/security');
  return { ok: true };
}
