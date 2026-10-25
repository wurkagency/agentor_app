import { getMembership } from '@agentor/db';
import { z } from 'zod';
import { env } from '@/server/env';
import { db } from '@/server/infra';
import { peekOAuthState } from '@/server/oauth';
import { claimKeyCallback, rememberConnection, storeConnection } from '@/server/providers';

const MANAGERS = new Set(['owner', 'admin', 'developer']);

const bodySchema = z.object({
  key_id: z.union([z.number(), z.string()]).optional(),
  /** Our one-time state token, which we sent as user_id. */
  user_id: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
  consumer_key: z.string().regex(/^ck_[A-Za-z0-9]{20,80}$/),
  consumer_secret: z.string().regex(/^cs_[A-Za-z0-9]{20,80}$/),
  key_permissions: z.string(),
});

/**
 * POST /api/connect/woocommerce/keys (PLAN-INTEGRATIONS-WOO-DINERO §4.1): the shop posts the new
 * REST keys here, server to server, before it sends the browser back. Nothing but the one-time
 * state ties the keys to a user, so the state is checked, claimed once, and the keys are sealed
 * at once; they are never stored in plain text, not even in Redis.
 */
export async function POST(req: Request) {
  const fail = (status: number) =>
    new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  if (env().CONNECTOR_MODE !== 'live') return fail(404);
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = (await req.text()).slice(0, 4096);
    const result = bodySchema.safeParse(JSON.parse(raw));
    if (!result.success) return fail(400);
    parsed = result.data;
  } catch {
    return fail(400);
  }
  if (parsed.key_permissions !== 'read_write') return fail(400);
  const state = await peekOAuthState(parsed.user_id);
  if (!state || state.connectorId !== 'woocommerce' || !state.baseUrl) return fail(404);
  const membership = await getMembership(db(), state.tenantId, state.userId);
  if (!membership || !MANAGERS.has(membership.role) || membership.signupState !== 'active')
    return fail(403);
  // A repeated delivery must not add a second connection.
  if (!(await claimKeyCallback(parsed.user_id))) return fail(200);
  const id = await storeConnection(state, {
    baseUrl: state.baseUrl,
    consumerKey: parsed.consumer_key,
    consumerSecret: parsed.consumer_secret,
  });
  await rememberConnection(parsed.user_id, id);
  return fail(200);
}
