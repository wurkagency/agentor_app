import { type NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/server/platform';

/**
 * Old Finans › Rapporter links (/platform/finance/reports[/export|/pdf]?month=YYYY-MM) land here
 * through next.config redirects and go on to Administration › Rapporter › Omsætning (README
 * decision 24) with the month as a from/to period. Kept for one release.
 */
export async function GET(req: NextRequest) {
  await requireStaff(true);
  const sp = req.nextUrl.searchParams;
  const month = /^(\d{4})-(\d{2})$/.exec(sp.get('month') ?? '');
  const next = new URL('/platform/admin/reports/revenue', req.nextUrl.origin);
  if (month) {
    const [y, m] = [Number(month[1]), Number(month[2])];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    next.searchParams.set('from', `${month[1]}-${month[2]}-01`);
    next.searchParams.set('to', `${month[1]}-${month[2]}-${String(last).padStart(2, '0')}`);
  }
  const format = sp.get('format');
  if (format === 'csv' || format === 'pdf') next.pathname += `/export.${format}`;
  return NextResponse.redirect(next, 308);
}
