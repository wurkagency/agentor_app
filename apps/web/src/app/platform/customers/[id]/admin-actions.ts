'use server';

import { QuickPayError } from '@agentor/billing';
import {
  deleteCustomer,
  PlatformError,
  providerSubscriptionFor,
  resendOwnerInvitation,
  setCustomerStatus,
  updateCustomer,
} from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { quickpay } from '@/server/billing';
import { optionalCvr } from '@/server/cvr';
import { db } from '@/server/infra';
import { appLink, sendEmail } from '@/server/mail';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';

/**
 * Customer administration on P2 (Superadmin): edit the details, send the owner a new invitation,
 * suspend or reactivate, and delete a customer that has never been invoiced. The database checks
 * the role again and writes the audit logs.
 */

const id = z.uuid();
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const detailsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  cvr: optionalCvr,
  addressLine: optional(160),
  postalCode: optional(10),
  city: optional(80),
  billingEmail: z
    .union([z.literal(''), z.email().max(200)])
    .transform((v) => (v ? v.toLowerCase() : null)),
});

const KNOWN = [
  'NOT_SUPERADMIN',
  'TENANT_NOT_FOUND',
  'TENANT_NAME_REQUIRED',
  'BILLING_EMAIL_INVALID',
  'REASON_REQUIRED',
  'HAS_OWNER',
  'OWNER_EMAIL_INVALID',
  'CONFIRM_NAME_MISMATCH',
  'HAS_INVOICES',
];

function codeOf(e: unknown): string {
  if (e instanceof PlatformError) return e.code;
  const msg = e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e);
  const known = KNOWN.find((k) => msg.includes(k));
  if (known) return known;
  console.error('customer admin action failed', msg);
  return 'generic';
}

const refresh = (tenantId: string) => {
  revalidatePath(`/platform/customers/${tenantId}`);
  revalidatePath('/platform/customers');
};

export async function updateCustomerAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = detailsSchema.safeParse(input);
  if (!id.safeParse(tenantId).success || !parsed.success) {
    const cvr = parsed.error?.issues.find((i) => i.path[0] === 'cvr')?.message;
    return { ok: false, error: cvr ?? 'invalid' };
  }
  try {
    await updateCustomer(db(), actor, tenantId, parsed.data);
  } catch (e) {
    return { ok: false, error: codeOf(e) };
  }
  refresh(tenantId);
  return { ok: true };
}

export async function setCustomerStatusAction(
  tenantId: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!id.safeParse(tenantId).success || !['active', 'suspended'].includes(status))
    return { ok: false, error: 'invalid' };
  try {
    await setCustomerStatus(db(), actor, tenantId, status, reason.trim().slice(0, 500));
  } catch (e) {
    return { ok: false, error: codeOf(e) };
  }
  refresh(tenantId);
  return { ok: true };
}

/** A new owner invitation (14 days) by e-mail, while the company has no owner yet. */
export async function resendOwnerInvitationAction(
  tenantId: string,
  email: string,
): Promise<ActionResult<{ email: string; mailed: boolean }>> {
  const { actor } = await requireStaff(true);
  const parsedEmail = z.union([z.literal(''), z.email().max(200)]).safeParse(email.trim());
  if (!id.safeParse(tenantId).success || !parsedEmail.success)
    return { ok: false, error: 'OWNER_EMAIL_INVALID' };
  let sent: { email: string; token: string };
  try {
    sent = await resendOwnerInvitation(db(), actor, tenantId, parsedEmail.data.toLowerCase());
  } catch (e) {
    return { ok: false, error: codeOf(e) };
  }
  // E11: 14 days; resendOwnerInvitation replaced the token, so earlier links are dead.
  const company = (await tenantNames(actor.userId)).get(tenantId) ?? '';
  let mailed = true;
  try {
    await sendEmail(
      'owner-reinvite',
      {
        staff: actor.name,
        company,
        url: appLink(`/invite/${sent.token}`),
        email: sent.email,
      },
      { to: sent.email, entityRef: `tenant-${tenantId}` },
    );
  } catch (err) {
    mailed = false;
    console.error('owner invitation mail failed', err instanceof Error ? err.message : err);
  }
  refresh(tenantId);
  return { ok: true, data: { email: sent.email, mailed } };
}

/**
 * Deletes a customer that has never been invoiced. The saved card at QuickPay is cancelled first,
 * as the signup purge does; if QuickPay can't be reached, nothing is deleted.
 */
export async function deleteCustomerAction(
  tenantId: string,
  confirmName: string,
): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  if (!id.safeParse(tenantId).success) return { ok: false, error: 'invalid' };
  const sub = await providerSubscriptionFor(db(), tenantId).catch(() => null);
  if (sub) {
    try {
      await quickpay().cancelSubscription(sub);
    } catch (e) {
      // Already cancelled or never authorised: nothing is saved at QuickPay to keep.
      if (!(e instanceof QuickPayError && e.status >= 400 && e.status < 500))
        return { ok: false, error: 'QUICKPAY_UNAVAILABLE' };
    }
  }
  try {
    await deleteCustomer(db(), actor, tenantId, confirmName);
  } catch (e) {
    return { ok: false, error: codeOf(e) };
  }
  revalidatePath('/platform/customers');
  return { ok: true };
}
