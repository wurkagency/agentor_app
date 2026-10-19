import { and, desc, eq, isNull } from 'drizzle-orm';
import { withTenant, type Database } from '../client.js';
import { notifications } from '../schema/index.js';

type Ctx = { tenantId: string; userId: string };

/** The signed-in user's notifications (RLS limits them to their own), newest first. */
export async function listNotifications(db: Database, ctx: Ctx, limit = 30) {
  return withTenant(db, ctx, (tx) =>
    tx.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit),
  );
}

export async function markNotificationsRead(db: Database, ctx: Ctx, id?: string) {
  await withTenant(db, ctx, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined)),
  );
}
