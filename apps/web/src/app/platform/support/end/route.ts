import { NextResponse, type NextRequest } from 'next/server';
import { SUPPORT_COOKIE } from '@/server/platform';

/**
 * Leaves the support view without logging time: used when the grant expired or was revoked
 * while the view was open (requireAppContext redirects here). Logged time goes through the
 * "Afslut supportvisning" dialog instead.
 */
export function GET(request: NextRequest) {
  const expired = request.nextUrl.searchParams.get('expired') === '1';
  const res = NextResponse.redirect(
    new URL(`/platform/customers${expired ? '?expired=1' : ''}`, request.url),
  );
  res.cookies.delete(SUPPORT_COOKIE);
  return res;
}
