import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers on every page (produktspecifikation §9.5): strict CSP with a per-request
 * nonce, frame-ancestors 'none', HSTS in production. Next.js reads the nonce from the request's
 * CSP header and applies it to its own scripts.
 *
 * Auth is not decided here: layouts call requireAppContext(), which validates the session and
 * the tenant against the database.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    // Inline style attributes are used for dynamic widths (meters) and by Radix positioning.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    // The PWA service worker (PLAN-MOBILE M3); strict-dynamic would otherwise block it.
    `worker-src 'self'`,
    `manifest-src 'self'`,
    // Terms and privacy policy from agentor.dk in the payment modal (PLAN-SIGNUP B6).
    `frame-src https://agentor.dk https://www.agentor.dk`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // The path for server code that needs it (support session log, P4/S5).
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  if (!dev)
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  return response;
}

export const config = {
  // Pages only: never static assets or the image optimiser (a lesson from agentor.dk).
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|logos/|fonts/|icons/|email/|api/auth).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
