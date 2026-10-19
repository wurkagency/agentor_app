import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { withTenant, type Database } from '../client.js';
import {
  authSessions,
  notificationPrefs,
  notificationSettings,
  NOTIFICATION_EVENTS,
  supportAccessGrants,
  tenants,
  type NotificationEvent,
} from '../schema/index.js';
import { writeAudit, type Actor } from './audit.js';

type Ctx = { tenantId: string; userId: string };

/* ---- Company (Virksomhed) ------------------------------------------------------------------------ */

export async function getCompany(db: Database, ctx: Ctx) {
  const rows = await withTenant(db, ctx, (tx) => tx.select().from(tenants).limit(1));
  return rows[0] ?? null;
}

export interface CompanyInput {
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  billingEmail: string | null;
  locale: 'da' | 'en';
  timeZone: string;
  currency: string;
}

export async function updateCompany(
  db: Database,
  actor: Actor,
  input: CompanyInput,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const [before] = await tx.select().from(tenants).limit(1);
    const res = await tx
      .update(tenants)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tenants.id, actor.tenantId))
      .returning({ id: tenants.id });
    if (!res.length) throw new Error('FORBIDDEN');
    await writeAudit(tx, actor, {
      action: 'company.updated',
      objectType: 'tenant',
      objectId: actor.tenantId,
      before: before && {
        name: before.name,
        cvr: before.cvr,
        city: before.city,
        locale: before.locale,
      },
      after: { name: input.name, cvr: input.cvr, city: input.city, locale: input.locale },
    });
  });
}

/* ---- Notifications ------------------------------------------------------------------------------- */

export type Channel = 'inApp' | 'email' | 'push' | 'sms';
export type PrefMatrix = Record<NotificationEvent, Record<Channel, boolean>>;

/** Critical events are always shown in the app (D12-Notifikationer: "Kan ikke slås fra"). */
export const CRITICAL_EVENTS: readonly NotificationEvent[] = [
  'connection_broken',
  'systematic_error',
];

/** Defaults: in-app for everything; e-mail for what needs action; nothing on SMS. */
export const DEFAULT_PREFS: PrefMatrix = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [
    e,
    {
      inApp: e !== 'weekly_summary',
      email: [
        'connection_broken',
        'systematic_error',
        'quota',
        'payment_failed',
        'weekly_summary',
      ].includes(e),
      push: ['connection_broken', 'systematic_error'].includes(e),
      sms: false,
    },
  ]),
) as PrefMatrix;

export async function getNotificationSettings(db: Database, ctx: Ctx) {
  return withTenant(db, ctx, async (tx) => {
    const prefs = await tx.select().from(notificationPrefs);
    const [settings] = await tx.select().from(notificationSettings).limit(1);
    const [tenant] = await tx
      .select({ rate: tenants.alertErrorRatePct, failures: tenants.alertConsecutiveFailures })
      .from(tenants)
      .limit(1);
    const matrix: PrefMatrix = structuredClone(DEFAULT_PREFS);
    for (const p of prefs)
      matrix[p.event] = { inApp: p.inApp, email: p.email, push: p.push, sms: p.sms };
    for (const e of CRITICAL_EVENTS) matrix[e].inApp = true;
    return {
      matrix,
      quiet: {
        enabled: settings?.quietEnabled ?? true,
        start: settings?.quietStart ?? '22:00',
        end: settings?.quietEnd ?? '07:00',
      },
      smsPhone: settings?.smsPhone ?? null,
      thresholds: { errorRatePct: tenant?.rate ?? 5, consecutiveFailures: tenant?.failures ?? 3 },
    };
  });
}

export async function saveNotificationSettings(
  db: Database,
  actor: Actor & { canEditThresholds: boolean },
  input: {
    matrix: PrefMatrix;
    quiet: { enabled: boolean; start: string; end: string };
    smsPhone: string | null;
    thresholds?: { errorRatePct: number; consecutiveFailures: number } | undefined;
  },
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    for (const event of NOTIFICATION_EVENTS) {
      const c = input.matrix[event];
      const values = {
        inApp: CRITICAL_EVENTS.includes(event) ? true : c.inApp,
        email: c.email,
        push: c.push,
        sms: c.sms,
        updatedAt: new Date(),
      };
      await tx
        .insert(notificationPrefs)
        .values({ tenantId: actor.tenantId, userId: actor.userId, event, ...values })
        .onConflictDoUpdate({
          target: [notificationPrefs.tenantId, notificationPrefs.userId, notificationPrefs.event],
          set: values,
        });
    }
    const s = {
      quietEnabled: input.quiet.enabled,
      quietStart: input.quiet.start,
      quietEnd: input.quiet.end,
      smsPhone: input.smsPhone,
      updatedAt: new Date(),
    };
    await tx
      .insert(notificationSettings)
      .values({ tenantId: actor.tenantId, userId: actor.userId, ...s })
      .onConflictDoUpdate({
        target: [notificationSettings.tenantId, notificationSettings.userId],
        set: s,
      });
    if (input.thresholds && actor.canEditThresholds) {
      await tx
        .update(tenants)
        .set({
          alertErrorRatePct: input.thresholds.errorRatePct,
          alertConsecutiveFailures: input.thresholds.consecutiveFailures,
        })
        .where(eq(tenants.id, actor.tenantId));
    }
    await writeAudit(tx, actor, {
      action: 'notifications.updated',
      objectType: 'notification_settings',
      after: {
        thresholds: actor.canEditThresholds ? input.thresholds : undefined,
        quiet: input.quiet,
      },
    });
  });
}

/* ---- Security ------------------------------------------------------------------------------------ */

export async function listUserSessions(db: Database, userId: string) {
  return db
    .select({
      id: authSessions.id,
      userAgent: authSessions.userAgent,
      ipAddress: authSessions.ipAddress,
      updatedAt: authSessions.updatedAt,
      createdAt: authSessions.createdAt,
    })
    .from(authSessions)
    .where(eq(authSessions.userId, userId))
    .orderBy(desc(authSessions.updatedAt));
}

export async function revokeUserSession(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const res = await db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), eq(authSessions.id, sessionId)))
    .returning({ id: authSessions.id });
  return res.length > 0;
}

export async function revokeOtherSessions(
  db: Database,
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const res = await db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), ne(authSessions.id, keepSessionId)))
    .returning({ id: authSessions.id });
  return res.length;
}

export async function getSecuritySettings(db: Database, ctx: Ctx) {
  return withTenant(db, ctx, async (tx) => {
    const [t] = await tx
      .select({
        requireMfaAll: tenants.requireMfaAll,
        supportRequiresApproval: tenants.supportRequiresApproval,
      })
      .from(tenants)
      .limit(1);
    const grants = await tx
      .select()
      .from(supportAccessGrants)
      .orderBy(desc(supportAccessGrants.requestedAt))
      .limit(5);
    return {
      requireMfaAll: t?.requireMfaAll ?? false,
      supportRequiresApproval: t?.supportRequiresApproval ?? true,
      grants,
    };
  });
}

export async function setTenantSecurity(
  db: Database,
  actor: Actor,
  input: { requireMfaAll?: boolean | undefined; supportRequiresApproval?: boolean | undefined },
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const set: Partial<typeof tenants.$inferInsert> = {};
    if (input.requireMfaAll !== undefined) set.requireMfaAll = input.requireMfaAll;
    if (input.supportRequiresApproval !== undefined)
      set.supportRequiresApproval = input.supportRequiresApproval;
    const res = await tx
      .update(tenants)
      .set(set)
      .where(eq(tenants.id, actor.tenantId))
      .returning({ id: tenants.id });
    if (!res.length) throw new Error('FORBIDDEN');
    await writeAudit(tx, actor, {
      action: 'security.updated',
      objectType: 'tenant',
      objectId: actor.tenantId,
      after: input,
    });
  });
}

export async function decideSupportGrant(
  db: Database,
  actor: Actor,
  grantId: string,
  decision: 'approve' | 'deny' | 'revoke',
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const now = new Date();
    const set =
      decision === 'approve'
        ? { approvedAt: now, approvedBy: actor.userId }
        : decision === 'deny'
          ? { deniedAt: now }
          : { revokedAt: now };
    const where =
      decision === 'revoke'
        ? and(eq(supportAccessGrants.id, grantId), isNull(supportAccessGrants.revokedAt))
        : and(
            eq(supportAccessGrants.id, grantId),
            isNull(supportAccessGrants.approvedAt),
            isNull(supportAccessGrants.deniedAt),
          );
    const res = await tx
      .update(supportAccessGrants)
      .set(set)
      .where(where)
      .returning({ caseRef: supportAccessGrants.caseRef });
    if (!res.length) throw new Error('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: `support.${decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'revoked'}`,
      objectType: 'support_access',
      objectId: grantId,
      after: { caseRef: res[0]!.caseRef },
    });
  });
}

/** Whether the tenant requires MFA for every member ("Kræv totrin for hele teamet"). */
export async function tenantRequiresMfa(db: Database, ctx: Ctx): Promise<boolean> {
  const rows = await withTenant(db, ctx, (tx) =>
    tx.select({ v: tenants.requireMfaAll }).from(tenants).limit(1),
  );
  return rows[0]?.v ?? false;
}

/** Alert thresholds (D2: error rate 5 %, 3 failures in a row), stored per tenant. */
export async function getTenantThresholds(db: Database, ctx: Ctx) {
  const [t] = await withTenant(db, ctx, (tx) =>
    tx
      .select({ rate: tenants.alertErrorRatePct, failures: tenants.alertConsecutiveFailures })
      .from(tenants)
      .limit(1),
  );
  return { errorRatePct: t?.rate ?? 5, consecutiveFailures: t?.failures ?? 3 };
}
