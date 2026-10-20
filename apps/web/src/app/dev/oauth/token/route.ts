import { NextResponse } from 'next/server';
import { decodeMockToken, mockSsoEnabled } from '@/server/mock-sso';

/** Mock identity provider: code → access token (SSO_MODE=mock only). */
export async function POST(request: Request) {
  if (!mockSsoEnabled()) return new NextResponse(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const code = form?.get('code');
  const identity = decodeMockToken(typeof code === 'string' ? code : null);
  if (!identity) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  return NextResponse.json({
    access_token: code,
    token_type: 'Bearer',
    expires_in: 300,
    scope: 'openid email profile',
  });
}
