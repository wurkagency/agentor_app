import type { NextRequest } from 'next/server';
import { monthFromQuery, parseMonth } from '@/server/finance-data';
import { csvResponse, reportCsv } from '@/server/finance-export';
import { requireStaff } from '@/server/platform';

/** "CSV" (F7): the monthly report. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const sp = req.nextUrl.searchParams;
  const m =
    monthFromQuery({ from: sp.get('from'), month: sp.get('month') }) ?? parseMonth(undefined);
  return csvResponse(await reportCsv(actor, m), `finans-${m.key}.csv`);
}
