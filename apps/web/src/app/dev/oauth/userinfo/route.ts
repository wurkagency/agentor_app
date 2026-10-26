import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { decodeMockToken, mockSsoEnabled } from '@/server/mock-sso';

/** Mock identity provider: the signed-in test identity (SSO_MODE=mock only). */
export async function GET(request: Request) {
  if (!mockSsoEnabled()) return new NextResponse(null, { status: 404 });
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  const identity = decodeMockToken(token);
  if (!identity) return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  return NextResponse.json({
    sub: createHash('sha256').update(`${identity.provider}:${identity.email}`).digest('hex'),
    email: identity.email,
    email_verified: true,
    name: identity.name,
  });
}
