'use server';

import {
  getNotificationSettings,
  revokeOtherSessions,
  revokeUserSession,
  saveNotificationSettings,
  saveProfile,
  setAvatarKey,
  DEFAULT_PREFS,
} from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actorFor, type ActionResult } from '../actor';
import { db } from '../infra';
import { storage } from '../storage';
import { AvatarRejected, avatarKey, processAvatar } from './avatar';
import { auditFor, ownerFor, type ProfileOwner } from './owner';

/**
 * Profile dashboard actions (PR1, D15, MP29, MA36). Every action acts on the signed-in user only:
 * the owner comes from the session, never from the input, and the database scopes the rows to
 * app.current_user_id() as well.
 */

const kind = z.enum(['staff', 'customer']);
const pathFor = (o: ProfileOwner) => (o.kind === 'staff' ? '/platform/profile' : '/profile');

const TIME_ZONES = [
  'Europe/Copenhagen',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Berlin',
  'Europe/London',
  'UTC',
] as const;

const profileSchema = z.object({
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+0-9 ()-]*$/),
  locale: z.enum(['da', 'en']),
  timeZone: z.enum(TIME_ZONES),
  city: z.string().trim().max(80),
  title: z.string().trim().max(80).optional(),
});

export async function saveProfileAction(
  who: 'staff' | 'customer',
  input: z.input<typeof profileSchema>,
): Promise<ActionResult> {
  const o = await ownerFor(kind.parse(who));
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;
  const { before, after } = await saveProfile(db(), o.session.user.id, {
    ...d,
    // A customer's role comes from the membership and can't be typed in.
    title: o.kind === 'staff' ? d.title : undefined,
  });
  await auditFor(o, 'profile.updated', { before, after });
  revalidatePath(pathFor(o));
  return { ok: true };
}

/** "Upload billede": PNG/JPEG ≥ 256 × 256 px, stored as a 512 px WebP without EXIF. */
export async function uploadAvatarAction(
  who: 'staff' | 'customer',
  form: FormData,
): Promise<ActionResult> {
  const o = await ownerFor(kind.parse(who));
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'TYPE' };
  let processed;
  try {
    processed = await processAvatar(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof AvatarRejected) return { ok: false, error: e.code };
    throw e;
  }
  const userId = o.session.user.id;
  const key = avatarKey(userId, processed.sha256);
  const store = storage();
  await store.put(key, processed.webp);
  const previous = await setAvatarKey(db(), userId, key);
  if (previous && previous !== key) await store.delete(previous);
  await auditFor(o, 'profile.avatar_changed', { bytes: processed.webp.length });
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeAvatarAction(who: 'staff' | 'customer'): Promise<ActionResult> {
  const o = await ownerFor(kind.parse(who));
  const previous = await setAvatarKey(db(), o.session.user.id, null);
  if (previous) await storage().delete(previous);
  await auditFor(o, 'profile.avatar_removed');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** "Log ud alle andre": every other session of the user, never anyone else's. */
export async function logoutOthersAction(
  who: 'staff' | 'customer',
): Promise<ActionResult<{ count: number }>> {
  const o = await ownerFor(kind.parse(who));
  const count = await revokeOtherSessions(db(), o.session.user.id, o.session.sessionId);
  await auditFor(o, 'session.revoked', { count });
  revalidatePath(pathFor(o));
  return { ok: true, data: { count } };
}

export async function logoutSessionAction(
  who: 'staff' | 'customer',
  sessionId: string,
): Promise<ActionResult> {
  const o = await ownerFor(kind.parse(who));
  if (!z.uuid().safeParse(sessionId).success || sessionId === o.session.sessionId)
    return { ok: false, error: 'NOT_FOUND' };
  const ok = await revokeUserSession(db(), o.session.user.id, sessionId);
  if (!ok) return { ok: false, error: 'NOT_FOUND' };
  await auditFor(o, 'session.revoked', { sessionId });
  revalidatePath(pathFor(o));
  return { ok: true };
}

const QUICK_EVENTS = ['connection_broken', 'systematic_error', 'quota', 'weekly_summary'] as const;

/**
 * D15 "Notifikationer": one switch per alert. Off stops the alert outside the app (e-mail, push,
 * SMS); on brings back the defaults. Everything else stays under "Alle indstillinger".
 */
export async function setQuickNotificationAction(
  event: (typeof QUICK_EVENTS)[number],
  on: boolean,
): Promise<ActionResult> {
  const o = await ownerFor('customer');
  if (!QUICK_EVENTS.includes(event)) return { ok: false, error: 'invalid' };
  const app = o.app!;
  const current = await getNotificationSettings(db(), {
    tenantId: app.tenant.tenantId,
    userId: app.user.id,
  });
  const matrix = structuredClone(current.matrix);
  const d = DEFAULT_PREFS[event];
  matrix[event] = on
    ? { ...matrix[event], email: true, push: d.push }
    : { ...matrix[event], email: false, push: false, sms: false };
  const actor = await actorFor(app);
  await saveNotificationSettings(
    db(),
    { ...actor, canEditThresholds: false },
    { matrix, quiet: current.quiet, smsPhone: current.smsPhone },
  );
  revalidatePath('/profile');
  return { ok: true };
}
