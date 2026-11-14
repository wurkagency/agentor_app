import type { NextRequest } from 'next/server';
import { requireStaff } from '@/server/platform';
import { reportExport } from '@/server/report-export';
import { reportRange } from '@/server/reports';

/** "PDF" on Administration › Rapporter › Support og tid (A3). Superadmin only. */
export async function GET(req: NextRequest) {
  const { actor } = await requireStaff(true);
  const sp = req.nextUrl.searchParams;
  const { range } = reportRange('support', {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
  });
  return reportExport(actor, 'support', 'pdf', range);
}
