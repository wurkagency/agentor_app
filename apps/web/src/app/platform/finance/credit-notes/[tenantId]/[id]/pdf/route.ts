import { isUuid } from '@agentor/db';
import { creditNoteDocument, signedDocumentUrl } from '@/server/documents';
import { requireStaff } from '@/server/platform';

/** Credit note PDF for Finans. Superadmin only. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string; id: string }> },
) {
  const { actor } = await requireStaff(true);
  const { tenantId, id } = await params;
  if (!isUuid(tenantId) || !isUuid(id)) return new Response(null, { status: 404 });
  const doc = await creditNoteDocument({ staffUserId: actor.userId }, tenantId, id);
  if (!doc) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { Location: signedDocumentUrl(doc.id), 'Cache-Control': 'private, no-store' },
  });
}
