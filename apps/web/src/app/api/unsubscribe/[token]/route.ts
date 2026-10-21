import { unsubscribeApply } from '@agentor/db';
import { db } from '@/server/infra';

/**
 * One-click unsubscribe (RFC 8058) from the List-Unsubscribe header of E22. Mail clients POST
 * "List-Unsubscribe=One-Click" here without cookies; the token is the proof. Always 200 for a
 * well-formed request so the client doesn't retry; nothing else is revealed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await unsubscribeApply(db(), token);
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
