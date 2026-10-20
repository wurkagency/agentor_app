import { NextResponse } from 'next/server';
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

/**
 * Mock identity provider: the consent form posts here and the browser is sent back to Better
 * Auth's callback with a code, as a real top-level redirect like Google's (SSO_MODE=mock only).
 */
export async function POST(request: Request) {
  if (!mockSsoEnabled()) return new NextResponse(null, { status: 404 });
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const p = parsed.data;
  const target = new URL(p.redirect_uri);
  // Only back to our own Better Auth callback.
  if (target.origin !== new URL(env().APP_URL).origin || !target.pathname.startsWith('/api/auth/'))
    return new NextResponse(null, { status: 400 });
  target.searchParams.set('code', encodeMockToken(p));
  target.searchParams.set('state', p.state);
  return NextResponse.redirect(target, 303);
}
