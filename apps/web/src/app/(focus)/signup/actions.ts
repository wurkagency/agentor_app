'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { clientIp } from '@/server/actor';
import { auth } from '@/server/auth/auth';
import { redisRateLimitStorage } from '@/server/auth/rate-limit';
import { sendMail } from '@/server/mail';

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((s) => s.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  terms: z.literal(true),
});

/**
 * New account (www.agentor.dk links here). The answer is the same whether or not the e-mail
 * already has an account, so the form can't be used to find customers; an existing user gets
 * a "you already have an account" mail instead. The account can't sign in before the e-mail
 * is confirmed, and the company is created in onboarding.
 */
export async function signUp(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { name, email, password } = parsed.data;

  const ip = (await clientIp()) ?? 'unknown';
  const limit = await redisRateLimitStorage.consume(`signup:${ip}`, { window: 3600, max: 10 });
  if (!limit.allowed) return { ok: false, error: 'rateLimited' };

  const ctx = await auth().$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    await sendMail({
      to: email,
      subject: 'Du har allerede en konto hos Agentor',
      text: `Hej\n\nNogen (forhåbentlig dig) forsøgte at oprette en konto med denne e-mail. Du har allerede en konto, så du kan bare logge ind:\n\n${ctx.baseURL.replace(/\/api\/auth$/, '')}/login\n\nHar du glemt adgangskoden, kan du nulstille den på login-siden.\n\nVenlig hilsen\nAgentor`,
    }).catch(() => undefined);
    return { ok: true };
  }

  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: false },
    { method: 'email-password' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  await auth().api.sendVerificationEmail({
    body: { email, callbackURL: '/onboarding' },
    headers: await headers(),
  });
  return { ok: true };
}
