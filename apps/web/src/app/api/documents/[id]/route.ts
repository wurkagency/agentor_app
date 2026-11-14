import { isUuid } from '@agentor/db';
import { documentResponse, verifyDocumentLink } from '@/server/documents';

/**
 * A stored invoice or credit note PDF behind a signed link (PLAN-EMAILS-PDF §6.3). The routes
 * that check who may read a document sign the link; it works for 5 minutes.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  if (
    !isUuid(id) ||
    !verifyDocumentLink(id, url.searchParams.get('exp'), url.searchParams.get('sig'))
  )
    return new Response(null, { status: 404 });
  return documentResponse(id);
}
