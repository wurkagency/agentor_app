import { manifestFor } from '@agentor/connectors';
import { isUuid } from '@agentor/db';
import { NextResponse, type NextRequest } from 'next/server';
import { getUserSession } from '@/server/auth/session';
import { env } from '@/server/env';
import { createOAuthState, mayConnect, safeReturn } from '@/server/oauth';
import { currentSupportView } from '@/server/platform';
import { providerAuthorizeUrl } from '@/server/providers';
import { validatePublicUrl } from '@agentor/http';

/**
 * GET /connect/[connector]/start?return=/onboarding/accounting[&baseUrl=…][&reconnect=…]
 * Starts connecting a system (PLAN-SIGNUP B11): checks who is asking, stores the state and sends
 * the browser to the provider. In mock mode the provider is the app's own consent page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connector: string }> },
) {
  const { connector } = await params;
  const url = request.nextUrl;
  const back = (q: string) =>
    NextResponse.redirect(
      new URL(`${safeReturn(url.searchParams.get('return'))}?${q}`, env().APP_URL),
    );
  const s = await getUserSession();
  if (!s) return NextResponse.redirect(new URL('/login', env().APP_URL));
  const m = manifestFor(connector);
  if (!m) return back('connectError=unknown');
  // Agentor support in the customer's app connects for that company, under its help grant.
  const view = await currentSupportView(s);
  if (view === 'expired') return back('connectError=forbidden');
  const who = view
    ? { tenantId: view.grant.tenantId, userId: s.user.id, supportGrantId: view.grant.grantId }
    : s.activeTenantId
      ? { tenantId: s.activeTenantId, userId: s.user.id, supportGrantId: null }
      : null;
  if (!who) return back('connectError=unknown');
  if (!(await mayConnect(who))) return back('connectError=forbidden');
  // A shop address for systems that live on the customer's own domain (WooCommerce).
  let baseUrl: string | null = null;
  const rawBase = url.searchParams.get('baseUrl');
  if (rawBase) {
    try {
      const u = new URL(rawBase);
      if (u.protocol !== 'https:') return back('connectError=httpsRequired');
      baseUrl = u.origin;
    } catch {
      return back('connectError=badUrl');
    }
  }
  const reconnect = url.searchParams.get('reconnect');
  const live = env().CONNECTOR_MODE === 'live';
  // A self-hosted shop must be public HTTPS before we send anyone there (SSRF, §9.4).
  if (live && baseUrl) {
    try {
      await validatePublicUrl(baseUrl);
    } catch {
      return back('connectError=badUrl');
    }
  }
  if (live && m.id === 'woocommerce' && !baseUrl) return back('connectError=badUrl');
  const state = {
    ...who,
    userName: s.user.name,
    connectorId: m.id,
    returnTo: safeReturn(url.searchParams.get('return')),
    baseUrl,
    reconnectId: reconnect && isUuid(reconnect) ? reconnect : null,
  };
  const token = await createOAuthState(state);
  if (live) {
    const to = providerAuthorizeUrl(state, token);
    return to ? NextResponse.redirect(to) : back('connectError=notAvailable');
  }
  return NextResponse.redirect(new URL(`/connect/${m.id}?state=${token}`, env().APP_URL));
}
