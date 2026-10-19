'use server';

import { NOTIFICATION_EVENTS, saveNotificationSettings, type PrefMatrix } from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';

const channels = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
  sms: z.boolean(),
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time');

const schema = z.object({
  matrix: z.object(
    Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, channels])) as Record<
      (typeof NOTIFICATION_EVENTS)[number],
      typeof channels
    >,
  ),
  quiet: z.object({ enabled: z.boolean(), start: time, end: time }),
  smsPhone: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^\+\d[\d ]{7,17}$/, 'phone'),
  ]),
  thresholds: z
    .object({
      errorRatePct: z.number().int().min(1).max(100),
      consecutiveFailures: z.number().int().min(1).max(100),
    })
    .optional(),
});

export async function saveNotifications(input: unknown): Promise<ActionResult> {
  const ctx = await requireCustomerArea();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const v = parsed.data;
  const actor = await actorFor(ctx);
  await saveNotificationSettings(
    db(),
    { ...actor, canEditThresholds: ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin' },
    {
      matrix: v.matrix as PrefMatrix,
      quiet: v.quiet,
      smsPhone: v.smsPhone === '' ? null : v.smsPhone.replace(/\s/g, ''),
      thresholds: v.thresholds,
    },
  );
  revalidatePath('/settings/notifications');
  return { ok: true };
}
