import type { Actor } from '@agentor/db';
import { headers } from 'next/headers';
import type { AppContext } from './auth/session';

/**
 * Client IP as seen behind Plesk/Nginx on the same host. Only the first X-Forwarded-For hop is
 * used, and only for the (masked) audit log; nothing is decided from it.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip');
}

export async function actorFor(
  ctx: AppContext,
): Promise<Actor & { role: AppContext['tenant']['role'] }> {
  return {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
    name: ctx.user.name,
    ip: await clientIp(),
    role: ctx.tenant.role,
    // Logged in the customer's audit log as Agentor support, with the staff member's name.
    ...(ctx.support ? { kind: 'support' as const } : {}),
  };
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
