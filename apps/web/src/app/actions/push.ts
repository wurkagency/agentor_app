'use server';

import {
  getDeviceToggles,
  removePushSubscription,
  savePushSubscription,
  setDeviceToggles,
  type PushToggles,
} from '@agentor/db';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { requireAppContext } from '@/server/auth/session';
import { db } from '@/server/infra';

/**
 * Web Push on this device (MA11, PLAN-MOBILE M3). Every call is for the signed-in user in the
 * current company; RLS keeps other people's devices out of reach.
 */

const endpoint = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/);
const key = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+=*$/);
const subscription = z.object({
  endpoint,
  keys: z.object({ p256dh: key, auth: key }),
});
const toggles = z.object({
  errors: z.boolean(),
  connection: z.boolean(),
  support: z.boolean(),
  quota: z.boolean(),
  weekly: z.boolean(),
});

const ctxOf = async () => {
  const ctx = await requireAppContext();
  // Support staff viewing a customer's app never receive the customer's pushes.
  if (ctx.support) return null;
  return { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
};

export async function subscribePush(
  input: unknown,
  label: unknown,
): Promise<ActionResult<{ toggles: PushToggles }>> {
  const c = await ctxOf();
  const sub = subscription.safeParse(input);
  if (!c || !sub.success) return { ok: false, error: 'invalid' };
  const name = typeof label === 'string' ? label.replace(/[\r\n]+/g, ' ').slice(0, 80) : '';
  const t = await savePushSubscription(db(), c, {
    endpoint: sub.data.endpoint,
    p256dh: sub.data.keys.p256dh,
    auth: sub.data.keys.auth,
    label: name,
  });
  return { ok: true, data: { toggles: t } };
}

export async function unsubscribePush(input: unknown): Promise<ActionResult> {
  const c = await ctxOf();
  const e = endpoint.safeParse(input);
  if (!c || !e.success) return { ok: false, error: 'invalid' };
  await removePushSubscription(db(), c, e.data);
  return { ok: true };
}

/** This device's toggles; null when the device isn't registered in this company. */
export async function devicePush(
  input: unknown,
): Promise<ActionResult<{ toggles: PushToggles | null }>> {
  const c = await ctxOf();
  const e = endpoint.safeParse(input);
  if (!c || !e.success) return { ok: false, error: 'invalid' };
  return { ok: true, data: { toggles: await getDeviceToggles(db(), c, e.data) } };
}

export async function setDevicePush(input: unknown, value: unknown): Promise<ActionResult> {
  const c = await ctxOf();
  const e = endpoint.safeParse(input);
  const v = toggles.safeParse(value);
  if (!c || !e.success || !v.success) return { ok: false, error: 'invalid' };
  const ok = await setDeviceToggles(db(), c, e.data, v.data);
  return ok ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
}
