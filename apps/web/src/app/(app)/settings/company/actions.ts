'use server';

import { updateCompany } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { companySchema } from './schema';

export async function saveCompany(input: unknown): Promise<ActionResult> {
  const ctx = await requireRole(['owner', 'admin']);
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const v = parsed.data;
  const orNull = (s: string) => (s === '' ? null : s);
  await updateCompany(db(), await actorFor(ctx), {
    name: v.name,
    cvr: orNull(v.cvr),
    addressLine: orNull(v.addressLine),
    postalCode: orNull(v.postalCode),
    city: orNull(v.city),
    billingEmail: orNull(v.billingEmail),
    locale: v.locale,
    timeZone: v.timeZone,
    currency: v.currency,
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}
