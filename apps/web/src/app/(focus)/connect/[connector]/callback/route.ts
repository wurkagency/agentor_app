import { manifestFor } from '@agentor/connectors';
import { getMembership } from '@agentor/db';
import { NextResponse, type NextRequest } from 'next/server';
import { getUserSession } from '@/server/auth/session';
import { env } from '@/server/env';
import { db } from '@/server/infra';
import { mockCredentials, takeOAuthState } from '@/server/oauth';
import { dineroCredentials, rememberedConnection, storeConnection } from '@/server/providers';

const MANAGERS = new Set(['owner', 'admin', 'developer']);

/**
 * GET /connect/[connector]/callback?code=…&state=…  (PLAN-SIGNUP B11)
 * Everything comes from the one-time state, not the browser's cookie: the connection is created
 * for the user and company that started it, whose access is checked again here. The browser that
 * started it goes back to the step; another browser (the phone's system browser) gets a page
 * that says to go back to the app, which picks the connection up on its own.
 *
 * Live providers (PLAN-INTEGRATIONS §4.1, §5.1): Dinero sends a code that is exchanged for tokens
 * here; WooCommerce already posted the keys to /api/connect/woocommerce/keys and only sends the
 * browser back (`success=1`).
 */
async function handle(connector: string, q: URLSearchParams) {
  const state = await takeOAuthState(q.get('state'));
  const app = env().APP_URL;
  if (!state || state.connectorId !== connector)
    return NextResponse.redirect(new URL('/connect/done?error=state', app));
  const back = (query: string) => NextResponse.redirect(new URL(`${state.returnTo}?${query}`, app));
  const live = env().CONNECTOR_MODE === 'live';
  const wooReturn = live && connector === 'woocommerce';
  if (q.get('error') || (wooReturn ? q.get('success') !== '1' : !q.get('code')))
    return back('connectError=denied');
  const membership = await getMembership(db(), state.tenantId, state.userId);
  if (!membership || !MANAGERS.has(membership.role) || membership.signupState !== 'active')
    return back('connectError=forbidden');
  const m = manifestFor(connector);
  if (!m) return back('connectError=unknown');
  let id: string;
  try {
    if (!live) id = await storeConnection(state, mockCredentials(connector, state.baseUrl));
    else if (connector === 'woocommerce') {
      const remembered = await rememberedConnection(q.get('state') ?? '');
      if (!remembered) return back('connectError=denied');
      id = remembered;
    } else if (connector === 'dinero') {
      id = await storeConnection(state, await dineroCredentials(q.get('code')!));
    } else return back('connectError=notAvailable');
  } catch {
    return back('connectError=failed');
  }
  const s = await getUserSession();
  if (s?.user.id === state.userId) return back(`connected=${id}`);
  return NextResponse.redirect(new URL(`/connect/done?name=${encodeURIComponent(m.name)}`, app));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connector: string }> },
) {
  return handle((await params).connector, request.nextUrl.searchParams);
}

/** Visma Connect may answer with `response_mode=form_post`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connector: string }> },
) {
  const form = await request.formData().catch(() => null);
  const q = new URLSearchParams();
  for (const k of ['code', 'state', 'error'])
    if (typeof form?.get(k) === 'string') q.set(k, form.get(k) as string);
  const res = await handle((await params).connector, q);
  // A redirect after POST must become a GET.
  return NextResponse.redirect(res.headers.get('location') ?? env().APP_URL, 303);
}
