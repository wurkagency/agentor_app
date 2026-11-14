'use server';

import { markNotificationsRead, searchRecords } from '@agentor/db';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';

export async function markAllNotificationsRead(): Promise<void> {
  const ctx = await requireAppContext();
  await markNotificationsRead(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
}

/** ⌘K: order numbers and names among the records the user may see (D1-Søg). */
export async function searchPalette(q: string) {
  const ctx = await requireAppContext();
  if (typeof q !== 'string' || q.trim().length < 2) return [];
  const rows = await searchRecords(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    q.slice(0, 64),
    5,
  );
  return rows.map((r) => ({
    label: r.label,
    customer: r.customer,
    outcome: r.outcome,
    flowId: r.flowId,
    at: r.createdAt.toISOString(),
  }));
}
