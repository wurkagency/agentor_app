import { timeBetween } from '@agentor/db';
import type { NextRequest } from 'next/server';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';

/** "Eksportér" (S6): the week's time entries, the staff member's own or the team's. */
export async function GET(request: NextRequest) {
  const { actor } = await requireStaff();
  const week = request.nextUrl.searchParams.get('week') ?? '';
  const team = request.nextUrl.searchParams.get('team') === '1';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return new Response('Bad request', { status: 400 });
  const from = new Date(`${week}T12:00:00Z`);
  const to = new Date(from.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [rows, names] = await Promise.all([
    timeBetween(db(), actor.userId, week, to, !team),
    tenantNames(actor.userId),
  ]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [
      'Dato',
      'Medarbejder',
      'Kunde',
      'Sag',
      'Type',
      'Kilde',
      'Minutter',
      'Fakturerbar',
      'Beskrivelse',
    ]
      .map(esc)
      .join(';'),
    ...rows.map((r) =>
      [
        r.workDate,
        r.staffName,
        r.tenantId ? names.get(r.tenantId) : '',
        r.caseId ?? '',
        r.kind,
        r.source,
        r.minutes,
        r.billable ? 'ja' : 'nej',
        r.description,
      ]
        .map(esc)
        .join(';'),
    ),
  ];
  return new Response(`\uFEFF${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tid-${week}.csv"`,
    },
  });
}
