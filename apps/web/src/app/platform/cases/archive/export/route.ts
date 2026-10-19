import type { NextRequest } from 'next/server';
import { requireStaff } from '@/server/platform';
import { archiveRows } from '../rows';

/** "Eksportér med tid" (S2): the filtered archive with time per case. */
export async function GET(request: NextRequest) {
  const { actor } = await requireStaff();
  const q = Object.fromEntries(request.nextUrl.searchParams);
  const rows = await archiveRows(actor.userId, q);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [
      'Sag',
      'Titel',
      'Løsning',
      'Kunde',
      'Kategori',
      'Status',
      'Supporter',
      'Oprettet',
      'Løst',
      'Minutter',
    ]
      .map(esc)
      .join(';'),
    ...rows.map((r) =>
      [
        r.number,
        r.title,
        r.resolution,
        r.tenantName,
        r.category,
        r.status,
        r.assigneeName,
        r.createdAt.toISOString(),
        r.resolvedAt?.toISOString(),
        r.minutes,
      ]
        .map(esc)
        .join(';'),
    ),
  ];
  return new Response(`\uFEFF${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sager-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
