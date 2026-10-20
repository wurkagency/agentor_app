import { manifestFor } from '@agentor/connectors';
import { createConnection, getMembership, reauthorizeConnection } from '@agentor/db';
import { NextResponse, type NextRequest } from 'next/server';
import { getUserSession } from '@/server/auth/session';
import { enqueueConnectionTest, hasWebhook, sealCredentials } from '@/server/connections';
import { env } from '@/server/env';
import { db } from '@/server/infra';
import { mockCredentials, takeOAuthState } from '@/server/oauth';

const MANAGERS = new Set(['owner', 'admin', 'developer']);

/**
 * GET /connect/[connector]/callback?code=…&state=…  (PLAN-SIGNUP B11)
 * Everything comes from the one-time state, not the browser's cookie: the connection is created
 * for the user and company that started it, whose access is checked again here. The browser that
 * started it goes back to the step; another browser (the phone's system browser) gets a page
 * that says to go back to the app, which picks the connection up on its own.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connector: string }> },
) {
  const { connector } = await params;
  const q = request.nextUrl.searchParams;
  const state = await takeOAuthState(q.get('state'));
  const app = env().APP_URL;
  if (!state || state.connectorId !== connector)
    return NextResponse.redirect(new URL('/connect/done?error=state', app));
  const back = (query: string) => NextResponse.redirect(new URL(`${state.returnTo}?${query}`, app));
  if (q.get('error') || !q.get('code')) return back('connectError=denied');
  const membership = await getMembership(db(), state.tenantId, state.userId);
  if (!membership || !MANAGERS.has(membership.role) || membership.signupState !== 'active')
    return back('connectError=forbidden');
  const m = manifestFor(connector);
  if (!m) return back('connectError=unknown');
  if (env().CONNECTOR_MODE !== 'mock') return back('connectError=notAvailable'); // FOLLOW-UP T1
  const creds = mockCredentials(connector, state.baseUrl);
  const actor = { tenantId: state.tenantId, userId: state.userId, name: state.userName, ip: null };
  let id: string;
  if (state.reconnectId) {
    await reauthorizeConnection(db(), actor, state.reconnectId, (cid) =>
      sealCredentials(actor.tenantId, cid, creds),
    );
    id = state.reconnectId;
  } else {
    const created = await createConnection(db(), actor, {
      connectorId: connector,
      name: state.baseUrl ? new URL(state.baseUrl).host : m.name,
      version: m.version,
      webhook: hasWebhook(connector),
      secretFor: (cid) => sealCredentials(actor.tenantId, cid, creds),
    });
    id = created.id;
  }
  await enqueueConnectionTest(actor.tenantId, id);
  const s = await getUserSession();
  if (s?.user.id === state.userId) return back(`connected=${id}`);
  return NextResponse.redirect(new URL(`/connect/done?name=${encodeURIComponent(m.name)}`, app));
}
