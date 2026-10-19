import type { NextRequest } from 'next/server';
import { parseMonth } from '@/server/finance-data';
import { csvResponse, timelogCsv } from '@/server/finance-export';
import { requireStaff } from '@/server/platform';

/** "Eksportér tidslog" (F3): every registration of the month with its billed time. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const m = parseMonth(req.nextUrl.searchParams.get('month') ?? undefined);
  return csvResponse(await timelogCsv(actor, m), `tidslog-${m.key}.csv`);
}
