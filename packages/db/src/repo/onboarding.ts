import { eq, isNull, sql } from 'drizzle-orm';
import { withoutTenant, withTenant, type Database } from '../client.js';
import { tenants } from '../schema/index.js';
import { writeAudit, type Actor } from './audit.js';

export class OnboardingError extends Error {
  constructor(readonly code: 'TENANT_NAME_REQUIRED' | 'TENANT_LIMIT' | 'FAILED') {
    super(code);
    this.name = 'OnboardingError';
  }
}

export interface NewCompany {
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  billingEmail: string | null;
  smsPhone: string | null;
  locale: 'da' | 'en';
  timeZone: string;
  ordersPerMonth: string | null;
}

/**
 * Onboarding step 1 (D14): the signed-in user creates the company and becomes its owner, on
 * Business with an incomplete subscription. Runs through app.create_tenant(), the only way a
 * tenant can be created at runtime.
 */
export async function createCompany(db: Database, userId: string, c: NewCompany): Promise<string> {
  try {
    const tenantId = await withoutTenant(
      db,
      async (tx) => {
        const res = await tx.execute<{ t: string }>(
          sql`select app.create_tenant(${c.name}, ${c.cvr ?? ''}, ${c.addressLine ?? ''}, ${c.postalCode ?? ''}, ${c.city ?? ''}, ${c.billingEmail ?? ''}, ${c.locale}, ${c.timeZone}, ${c.ordersPerMonth ?? ''}) as t`,
        );
        return res.rows[0]!.t;
      },
      userId,
    );
    if (c.smsPhone) {
      await withTenant(db, { tenantId, userId }, (tx) =>
        tx.update(tenants).set({ smsPhone: c.smsPhone }).where(eq(tenants.id, tenantId)),
      );
    }
    return tenantId;
  } catch (e) {
    const msg =
      e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
    if (msg.includes('TENANT_NAME_REQUIRED')) throw new OnboardingError('TENANT_NAME_REQUIRED');
    if (msg.includes('TENANT_LIMIT')) throw new OnboardingError('TENANT_LIMIT');
    throw e;
  }
}

/** Last onboarding step, chosen template or skipped. Idempotent. */
export async function completeOnboarding(
  db: Database,
  actor: Actor,
  template: string | null,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(tenants)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(isNull(tenants.onboardingCompletedAt))
      .returning({ id: tenants.id });
    if (res.length) {
      await writeAudit(tx, actor, {
        action: 'company.onboarded',
        objectType: 'tenant',
        objectId: actor.tenantId,
        after: { template },
      });
    }
  });
}
