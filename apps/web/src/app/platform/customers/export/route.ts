import { requireStaff } from '@/server/platform';
import { customersFor, planNames } from '@/server/platform-data';

/** "Eksportér liste" (P1): the same columns as the list, nothing more. */
export async function GET() {
  const { actor } = await requireStaff();
  const [rows, plans] = await Promise.all([customersFor(actor.userId), planNames()]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Kunde', 'CVR', 'Plan', 'Status', 'Flows', 'Fejl i dag', 'Sidste kørsel'].map(esc).join(';'),
    ...rows.map((r) =>
      [
        r.name,
        r.cvr,
        (r.planId && plans.get(r.planId)) || '',
        r.status,
        r.flows,
        r.errorsToday,
        r.lastRunAt?.toISOString() ?? '',
      ]
        .map(esc)
        .join(';'),
    ),
  ];
  return new Response(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kunder-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
