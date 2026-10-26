import { isUuid } from '@agentor/db';
import { invoiceDocument, signedDocumentUrl } from '@/server/documents';
import { requireStaff } from '@/server/platform';

/** Invoice PDF for Finans (F4, F6): the same stored document the customer downloads. Superadmin. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string; invoiceId: string }> },
) {
  const { actor } = await requireStaff(true);
  const { tenantId, invoiceId } = await params;
  if (!isUuid(tenantId) || !isUuid(invoiceId)) return new Response(null, { status: 404 });
  const doc = await invoiceDocument({ staffUserId: actor.userId }, tenantId, invoiceId);
  if (!doc) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { Location: signedDocumentUrl(doc.id), 'Cache-Control': 'private, no-store' },
  });
}
