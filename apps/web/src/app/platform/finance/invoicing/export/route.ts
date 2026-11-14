import type { NextRequest } from 'next/server';
import { parseMonth } from '@/server/finance-data';
import { csvResponse, invoicesCsv } from '@/server/finance-export';
import { requireStaff } from '@/server/platform';

/** "Eksportér til bogføring" (F6): the invoices of a month, or all with ?month=all. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const month = req.nextUrl.searchParams.get('month');
  const m = month === 'all' || !month ? undefined : parseMonth(month);
  return csvResponse(await invoicesCsv(actor, m), `fakturaer-${m?.key ?? 'alle'}.csv`);
}
