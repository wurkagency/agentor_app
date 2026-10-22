import { isUuid } from '@agentor/db';
import { requireRole } from '@/server/auth/session';
import { invoiceDocument, signedDocumentUrl } from '@/server/documents';

/**
 * Invoice as PDF (I01). Owner only: the database returns nothing for another company or role.
 * The PDF is rendered once per state and kept; this answers with a 5-minute signed link to it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(['owner']);
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const doc = await invoiceDocument(
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    ctx.tenant.tenantId,
    id,
  );
  if (!doc) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { Location: signedDocumentUrl(doc.id), 'Cache-Control': 'private, no-store' },
  });
}
