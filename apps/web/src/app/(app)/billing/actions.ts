'use server';

import { BillingError, buyTransactionAddon, changeInterval, changePlan } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { startCardSetup } from '@/server/billing';
import { db } from '@/server/infra';

const planSchema = z.enum(['startup', 'business', 'enterprise']);

/** Owner only (§6). Downgrades over the new plan's limits are refused in the repository too. */
export async function switchPlan(planId: string): Promise<ActionResult<{ blockers?: string[] }>> {
  const ctx = await requireRole(['owner']);
  const parsed = planSchema.safeParse(planId);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await changePlan(db(), await actorFor(ctx), parsed.data);
  } catch (e) {
    if (e instanceof BillingError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** "Skift til årlig" / "Skift til månedlig" (D13), from the next renewal. Owner only. */
export async function switchInterval(interval: string): Promise<ActionResult> {
  const ctx = await requireRole(['owner']);
  const parsed = z.enum(['month', 'year']).safeParse(interval);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await changeInterval(db(), await actorFor(ctx), parsed.data);
  } catch (e) {
    if (e instanceof BillingError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/billing');
  return { ok: true };
}

export async function changeCard(): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireRole(['owner']);
  const url = await startCardSetup(ctx, {
    continuePath: '/billing/payment?card=return',
    cancelPath: '/billing/payment',
  });
  return { ok: true, data: { url } };
}

/** Extra transactions in blocks of 1.000 for this month (D2), added to the next invoice. */
export async function buyAddon(blocks: number): Promise<ActionResult> {
  const ctx = await requireRole(['owner']);
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 50)
    return { ok: false, error: 'invalid' };
  await buyTransactionAddon(db(), await actorFor(ctx), blocks);
  revalidatePath('/', 'layout');
  return { ok: true };
}
