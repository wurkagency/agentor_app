'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@/server/env';
import { encodeMockToken, mockSsoEnabled, SSO_PROVIDERS } from '@/server/mock-sso';

const schema = z.object({
  provider: z.enum(SSO_PROVIDERS),
  redirect_uri: z.string().url(),
  state: z.string().min(1).max(512),
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
});

/** Sends the browser back to Better Auth's callback with a code, like a real provider. */
export async function approveMockSso(form: FormData): Promise<void> {
  if (!mockSsoEnabled()) throw new Error('mock SSO is off');
  const p = schema.parse(Object.fromEntries(form));
  const target = new URL(p.redirect_uri);
  // Only back to our own Better Auth callback.
  if (target.origin !== new URL(env().APP_URL).origin || !target.pathname.startsWith('/api/auth/'))
    throw new Error('redirect_uri not allowed');
  target.searchParams.set('code', encodeMockToken(p));
  target.searchParams.set('state', p.state);
  redirect(target.toString());
}
