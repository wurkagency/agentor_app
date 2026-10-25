import { createConnection, reauthorizeConnection } from '@agentor/db';
import { dineroAuthorizeUrl, vismaToken } from '@agentor/connectors/live';
import { manifestFor } from '@agentor/connectors';
import { enqueueConnectionTest, hasWebhook, sealCredentials } from './connections';
import { env } from './env';
import { db, redis } from './infra';
import type { OAuthState } from './oauth';

/**
 * The real providers behind "Forbind" (PLAN-INTEGRATIONS-WOO-DINERO §4.1, §5.1), replacing the
 * mock consent page when CONNECTOR_MODE=live:
 * - WooCommerce: the shop's own key flow (/wc-auth/v1/authorize). The shop posts the keys to us
 *   server-to-server, then sends the browser back.
 * - Dinero: Visma Connect authorization code flow.
 */

export const WOO_KEYS_PATH = '/api/connect/woocommerce/keys';
const CONN_TTL = 600;
const connKey = (token: string) => `agentor:connect:conn:${token}`;

/** Where the browser goes to log in at the provider; null when the connector has no live login. */
export function providerAuthorizeUrl(state: OAuthState, token: string): string | null {
  const app = env().APP_URL;
  if (state.connectorId === 'woocommerce') {
    if (!state.baseUrl) return null;
    const u = new URL('/wc-auth/v1/authorize', state.baseUrl);
    u.searchParams.set('app_name', 'Agentor');
    u.searchParams.set('scope', 'read_write');
    // WooCommerce posts this back with the keys; the one-time state token ties them to the user.
    u.searchParams.set('user_id', token);
    u.searchParams.set(
      'return_url',
      new URL(`/connect/woocommerce/callback?state=${token}`, app).toString(),
    );
    u.searchParams.set('callback_url', new URL(WOO_KEYS_PATH, app).toString());
    return u.toString();
  }
  if (state.connectorId === 'dinero') {
    const { DINERO_CLIENT_ID: clientId, VISMA_CONNECT_URL: connectUrl } = env();
    if (!clientId) return null;
    return dineroAuthorizeUrl({
      clientId,
      redirectUri: new URL('/connect/dinero/callback', app).toString(),
      state: token,
      ...(connectUrl ? { connectUrl } : {}),
    });
  }
  return null;
}

/** Visma Connect: the code from the callback for tokens, never seen by the browser. */
export async function dineroCredentials(code: string): Promise<Record<string, string>> {
  const {
    DINERO_CLIENT_ID: clientId,
    DINERO_CLIENT_SECRET: clientSecret,
    VISMA_CONNECT_URL,
  } = env();
  if (!clientId || !clientSecret) throw new Error('Dinero OAuth client is not configured');
  const t = await vismaToken(
    { clientId, clientSecret, ...(VISMA_CONNECT_URL ? { connectUrl: VISMA_CONNECT_URL } : {}) },
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: new URL('/connect/dinero/callback', env().APP_URL).toString(),
    },
  );
  return { ...t };
}

/**
 * Creates the connection (or gives a broken one new credentials) for the user and company in the
 * state, seals the credentials and asks the worker to test it. Returns the connection id.
 */
export async function storeConnection(
  state: OAuthState,
  creds: Record<string, string>,
): Promise<string> {
  const m = manifestFor(state.connectorId);
  if (!m) throw new Error('unknown connector');
  const actor = { tenantId: state.tenantId, userId: state.userId, name: state.userName, ip: null };
  const webhook = hasWebhook(state.connectorId);
  let id: string;
  if (state.reconnectId) {
    await reauthorizeConnection(
      db(),
      actor,
      state.reconnectId,
      (cid, token) => sealCredentials(actor.tenantId, cid, creds, token),
      { webhook },
    );
    id = state.reconnectId;
  } else {
    const created = await createConnection(db(), actor, {
      connectorId: state.connectorId,
      name: state.baseUrl ? new URL(state.baseUrl).host : m.name,
      version: m.version,
      webhook,
      secretFor: (cid, token) => sealCredentials(actor.tenantId, cid, creds, token),
    });
    id = created.id;
  }
  await enqueueConnectionTest(actor.tenantId, id);
  return id;
}

/** The WooCommerce key callback stores the connection for the browser's return. */
export async function rememberConnection(token: string, connectionId: string) {
  await redis().set(connKey(token), connectionId, 'EX', CONN_TTL);
}

/** One use: claims the right to store keys for a state, so a repeated callback can't add twice. */
export async function claimKeyCallback(token: string): Promise<boolean> {
  return (await redis().set(`${connKey(token)}:claimed`, '1', 'EX', CONN_TTL, 'NX')) === 'OK';
}

export async function rememberedConnection(token: string): Promise<string | null> {
  return redis().get(connKey(token));
}
