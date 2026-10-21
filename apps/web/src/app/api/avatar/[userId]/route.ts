import { avatarKeyFor } from '@agentor/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getUserSession } from '@/server/auth/session';
import { db } from '@/server/infra';
import { storage } from '@/server/storage';

/**
 * A profile photo (PR1/D15), only for someone allowed to see it: the user themselves, a colleague
 * in a company they share, or staff seeing staff (app.avatar_key_for, 0051). Never public, never
 * cached by shared caches. 404 for "no photo" and "not allowed" alike.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) return new Response(null, { status: 404 });
  const session = await getUserSession();
  if (!session) return new Response(null, { status: 404 });
  const key = await avatarKeyFor(db(), session.user.id, userId);
  if (!key) return new Response(null, { status: 404 });
  const etag = `"${key.slice(-69, -5)}"`;
  const headers = {
    'Cache-Control': 'private, max-age=300',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  const file = await storage().get(key);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: { ...headers, 'Content-Type': 'image/webp', 'Content-Length': String(file.length) },
  });
}
