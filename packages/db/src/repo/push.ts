import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { withTenant, type Database } from '../client.js';
import {
  DEFAULT_PUSH_TOGGLES,
  notifications,
  notificationSettings,
  pushSubscriptions,
  supportAccessGrants,
  type PushToggles,
} from '../schema/index.js';

type Ctx = { tenantId: string; userId: string };

/* ---- Web: the signed-in user's own devices (MA11) ---------------------------------------------- */

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}

/** Registers this device for the user in the current company, or refreshes its keys. */
export async function savePushSubscription(
  db: Database,
  ctx: Ctx,
  sub: DeviceSubscription,
): Promise<PushToggles> {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        label: sub.label,
        events: DEFAULT_PUSH_TOGGLES,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.tenantId, pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dh: sub.p256dh, auth: sub.auth, label: sub.label, lastSeenAt: new Date() },
      })
      .returning({ events: pushSubscriptions.events });
    return { ...DEFAULT_PUSH_TOGGLES, ...(row?.events ?? {}) };
  });
}

export async function removePushSubscription(db: Database, ctx: Ctx, endpoint: string) {
  await withTenant(db, ctx, (tx) =>
    tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)),
  );
}

/** This device's toggles, or null when the device isn't registered in this company. */
export async function getDeviceToggles(
  db: Database,
  ctx: Ctx,
  endpoint: string,
): Promise<PushToggles | null> {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .select({ events: pushSubscriptions.events })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    return row ? { ...DEFAULT_PUSH_TOGGLES, ...row.events } : null;
  });
}

export async function setDeviceToggles(
  db: Database,
  ctx: Ctx,
  endpoint: string,
  toggles: PushToggles,
): Promise<boolean> {
  return withTenant(db, ctx, async (tx) => {
    const res = await tx
      .update(pushSubscriptions)
      .set({ events: toggles, lastSeenAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning({ id: pushSubscriptions.id });
    return res.length > 0;
  });
}

/** How many devices the user has registered here (desktop D12 "push på mindst én enhed", B8). */
export async function countMyDevices(db: Database, ctx: Ctx): Promise<number> {
  return withTenant(db, ctx, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions);
    return r?.n ?? 0;
  });
}

/* ---- Worker: draining the push queue ---------------------------------------------------------- */

export interface DuePush {
  id: number;
  tenantId: string;
  notificationId: string;
  userId: string;
  kind: 'new' | 'resolved';
}

export async function duePushes(db: Database, now = new Date()): Promise<DuePush[]> {
  const res = await db.execute<{
    id: string;
    tenant_id: string;
    notification_id: string;
    user_id: string;
    kind: 'new' | 'resolved';
  }>(sql`select * from app.due_pushes(${now.toISOString()}::timestamptz)`);
  return res.rows.map((r) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    notificationId: r.notification_id,
    userId: r.user_id,
    kind: r.kind,
  }));
}

export async function pushDone(db: Database, id: number) {
  await db.execute(sql`select app.push_done(${id}::bigint)`);
}

export async function pushDefer(db: Database, id: number, until: Date) {
  await db.execute(sql`select app.push_defer(${id}::bigint, ${until.toISOString()}::timestamptz)`);
}

/** What the worker needs to send one push: the notification, the user's devices and quiet hours. */
export async function pushContext(db: Database, p: DuePush) {
  return withTenant(db, { tenantId: p.tenantId }, async (tx) => {
    const [n] = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, p.notificationId), eq(notifications.userId, p.userId)));
    if (!n) return null;
    const devices = await tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, p.userId));
    const [settings] = await tx
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, p.userId));
    return {
      notification: n,
      devices: devices.map((d) => ({ ...d, events: { ...DEFAULT_PUSH_TOGGLES, ...d.events } })),
      quiet: settings
        ? { enabled: settings.quietEnabled, start: settings.quietStart, end: settings.quietEnd }
        : { enabled: true, start: '22:00', end: '07:00' },
    };
  });
}

/** The push service said the subscription is gone (404/410): forget the device. */
export async function dropPushSubscription(db: Database, tenantId: string, id: string) {
  await withTenant(db, { tenantId }, (tx) =>
    tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)),
  );
}

/* ---- MA15: the company's running support total ------------------------------------------------- */

export async function customerSupportMonth(db: Database, ctx: Ctx) {
  return withTenant(db, ctx, async (tx) => {
    const res = await tx.execute<{
      registered_minutes: number;
      billed_minutes: number;
      rate_ore: number;
    }>(sql`select * from app.customer_support_month()`);
    const r = res.rows[0];
    return {
      registeredMinutes: Number(r?.registered_minutes ?? 0),
      billedMinutes: Number(r?.billed_minutes ?? 0),
      rateOre: Number(r?.rate_ore ?? 0),
    };
  });
}

/**
 * The support request a "supportRequested" notification is about: the newest unanswered request
 * made just before it (the SQL function writes both in one transaction). Opens MA12 from the push.
 */
export async function latestPendingGrant(
  db: Database,
  tenantId: string,
  notifiedAt: Date,
): Promise<string | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [g] = await tx
      .select({ id: supportAccessGrants.id })
      .from(supportAccessGrants)
      .where(
        and(
          isNull(supportAccessGrants.approvedAt),
          isNull(supportAccessGrants.deniedAt),
          eq(supportAccessGrants.superadmin, false),
          lte(supportAccessGrants.requestedAt, new Date(notifiedAt.getTime() + 60_000)),
        ),
      )
      .orderBy(desc(supportAccessGrants.requestedAt))
      .limit(1);
    return g?.id ?? null;
  });
}
