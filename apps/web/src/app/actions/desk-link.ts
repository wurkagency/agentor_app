'use server';

import { getTranslations } from 'next-intl/server';
import { deskLinkPath } from '@/lib/desk-link';
import type { ActionResult } from '@/server/actor';
import { requireUser } from '@/server/auth/session';
import { redisRateLimitStorage } from '@/server/auth/rate-limit';
import { env } from '@/server/env';
import { sendMail } from '@/server/mail';

/**
 * "Send link til min computer" (README decision 20): e-mails the signed-in user a link to the same
 * page. Only to the user themself, only app paths, at most 5 an hour. No page data in the mail;
 * the page checks access as usual when the link is opened. Not in the audit log (PLAN-MOBILE B11).
 */
export async function sendDeskLink(
  path: unknown,
  title: unknown,
): Promise<ActionResult<{ email: string }>> {
  const { user } = await requireUser();
  const target = deskLinkPath(path);
  if (!target) return { ok: false, error: 'invalid' };
  const limit = await redisRateLimitStorage.consume(`desk-link:${user.id}`, {
    window: 3600,
    max: 5,
  });
  if (!limit.allowed) return { ok: false, error: 'rateLimited' };
  const t = await getTranslations('mobile.desk.mail');
  // The page title goes into the subject: one line, short.
  const clean = typeof title === 'string' ? title.replace(/[\r\n]+/g, ' ').trim() : '';
  const page = clean ? clean.slice(0, 120) : t('page');
  const url = new URL(target, env().APP_URL).toString();
  await sendMail({
    to: user.email,
    subject: t('subject', { page }),
    text: t('body', { page, url }),
  });
  return { ok: true, data: { email: user.email } };
}
