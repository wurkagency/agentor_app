'use server';

import { PlatformError, updatePlan } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

const limit = z.number().int().min(0).max(100_000_000).nullable();

/** Platformindstillinger: a plan's monthly price and limits. Superadmin only. */
export async function savePlanAction(input: {
  planId: string;
  priceKr: number;
  seats: number | null;
  transactionsPerMonth: number | null;
  integrationSets: number | null;
  destinationsPerFlow: number | null;
  pollingIntervalMinutes: number;
}): Promise<ActionResult> {
  const { actor } = await requireStaff(true);
  const parsed = z
    .object({
      planId: z.enum(['startup', 'business', 'enterprise']),
      priceKr: z.number().min(0).max(100_000),
      seats: limit,
      transactionsPerMonth: limit,
      integrationSets: limit,
      destinationsPerFlow: limit,
      pollingIntervalMinutes: z.number().int().min(1).max(1440),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;
  try {
    await updatePlan(db(), actor, d.planId, {
      priceMonthlyOre: Math.round(d.priceKr * 100),
      values: {
        seats: d.seats,
        transactions_per_month: d.transactionsPerMonth,
        integration_sets: d.integrationSets,
        destinations_per_flow: d.destinationsPerFlow,
        polling_interval_minutes: d.pollingIntervalMinutes,
      },
    });
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
