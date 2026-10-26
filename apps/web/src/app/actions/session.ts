'use server';

import { getMembership, isUuid, setSessionTenant, setUserLocale } from '@agentor/db';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LOCALE_COOKIE } from '@/i18n/request';
import { getUserSession, requireUser } from '@/server/auth/session';
import { db } from '@/server/infra';

const ONE_YEAR = 60 * 60 * 24 * 365;

async function setLocaleCookie(locale: 'da' | 'en') {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });
}

/** After login: use the language stored on the user (profile menu "Sprog"). */
export async function syncLocale(): Promise<void> {
  const s = await getUserSession();
  if (s) await setLocaleCookie(s.user.locale);
}

export async function changeLocale(locale: 'da' | 'en'): Promise<void> {
  if (locale !== 'da' && locale !== 'en') return;
  const s = await requireUser();
  await setUserLocale(db(), s.user.id, locale);
  await setLocaleCookie(locale);
  revalidatePath('/', 'layout');
}

/**
 * "Skift virksomhed": the target tenant is checked against the user's memberships before it is
 * stored on the session. The id from the client is only a choice, never trusted as context.
 */
export async function switchTenant(tenantId: string): Promise<{ ok: boolean }> {
  if (!isUuid(tenantId)) return { ok: false };
  const s = await requireUser();
  const membership = await getMembership(db(), tenantId, s.user.id);
  if (!membership) return { ok: false };
  await setSessionTenant(db(), s.sessionId, tenantId);
  revalidatePath('/', 'layout');
  return { ok: true };
}
