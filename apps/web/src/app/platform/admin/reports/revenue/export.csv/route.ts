import { logExport } from '@agentor/db';
import type { NextRequest } from 'next/server';
import { currentMonth, monthFromQuery, shiftMonth } from '@/server/finance-data';
import { csvResponse, reportCsv } from '@/server/finance-export';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

/** "CSV" (F7, Administration › Rapporter › Omsætning): the monthly report, ex. VAT. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const sp = req.nextUrl.searchParams;
  const m =
    monthFromQuery({ from: sp.get('from'), month: sp.get('month') }) ??
    shiftMonth(currentMonth(), -1);
  const body = await reportCsv(actor, m);
  await logExport(db(), actor, {
    report: 'revenue',
    format: 'csv',
    from: m.firstDay,
    to: m.lastDay,
    rows: body.split('\r\n').length - 2,
  });
  return csvResponse(body, `agentor-omsaetning-${m.key}.csv`);
}
