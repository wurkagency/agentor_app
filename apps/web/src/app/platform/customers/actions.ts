'use server';

import { createCustomer, listPlans, PlatformError } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { parseCvr, subscriptionPriceOre, withVat } from '@agentor/core';
import { CVR_ERROR, cvrProvider, optionalCvr, type CvrCompany } from '@/server/cvr';
import { db } from '@/server/infra';
import { appLink, sendEmail } from '@/server/mail';
import { requireStaff } from '@/server/platform';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  cvr: optionalCvr,
  addressLine: optional(160),
  postalCode: optional(10),
  city: optional(80),
  billingEmail: z
    .union([z.literal(''), z.email().max(200)])
    .transform((v) => (v ? v.toLowerCase() : null)),
  ownerEmail: z
    .email()
    .max(200)
    .transform((v) => v.toLowerCase()),
  planId: z.string().min(1).max(40),
  interval: z.enum(['month', 'year']),
});

const KNOWN = ['TENANT_NAME_REQUIRED', 'OWNER_EMAIL_INVALID', 'PLAN_INVALID', 'NOT_SUPERADMIN'];

/**
 * "Opret kunde" (Superadmin): the company with its plan, waiting for payment, and an e-mail to the
 * owner, who creates their login, accepts the terms and pays by card on SU5. The company becomes
 * active only through QuickPay's verified callback, as for self-service signup.
 */
export async function createCustomerAction(
  input: unknown,
): Promise<ActionResult<{ tenantId: string; mailed: boolean }>> {
  const { actor } = await requireStaff(true);
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    const cvr = parsed.error.issues.find((i) => i.path[0] === 'cvr')?.message;
    return { ok: false, error: cvr ?? 'invalid' };
  }
  const c = parsed.data;
  let created: { tenantId: string; token: string };
  try {
    created = await createCustomer(db(), actor, c);
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    const msg = e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : '';
    const code = KNOWN.find((k) => msg.includes(k));
    if (code) return { ok: false, error: code };
    throw e;
  }
  const plan = (await listPlans(db())).find((p) => p.id === c.planId);
  // E10: 14 days; the company is active only after the first payment.
  const priceNetOre = subscriptionPriceOre({
    monthlyOre: plan?.priceMonthlyOre ?? 0,
    interval: c.interval,
  });
  let mailed = true;
  try {
    await sendEmail(
      'customer-created',
      {
        staff: actor.name,
        company: c.name,
        plan: plan?.name ?? c.planId,
        interval: c.interval,
        priceNetOre,
        firstPaymentGrossOre: withVat(priceNetOre).gross,
        url: appLink(`/invite/${created.token}`),
        email: c.ownerEmail,
      },
      { to: c.ownerEmail, entityRef: `tenant-${created.tenantId}` },
    );
  } catch (err) {
    mailed = false;
    console.error('customer invitation mail failed', err instanceof Error ? err.message : err);
  }
  revalidatePath('/platform/customers', 'layout');
  return { ok: true, data: { tenantId: created.tenantId, mailed } };
}

/** CVR lookup in the dialog, as on SU3; a failed lookup only means manual entry. */
export async function lookupCustomerCvr(cvr: string): Promise<ActionResult<CvrCompany>> {
  await requireStaff(true);
  const valid = parseCvr(String(cvr));
  if (!valid.ok) return { ok: false, error: CVR_ERROR[valid.reason] };
  const clean = valid.cvr;
  try {
    const found = await cvrProvider().lookup(clean);
    return found ? { ok: true, data: found } : { ok: false, error: 'notFound' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
