import { isUuid } from '@agentor/db';
import { requireRole } from '@/server/auth/session';
import { creditNoteDocument, signedDocumentUrl } from '@/server/documents';

/** Credit note as PDF (I02) on Abonnement › Fakturaer. Owner only, like invoices. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(['owner']);
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const doc = await creditNoteDocument(
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
