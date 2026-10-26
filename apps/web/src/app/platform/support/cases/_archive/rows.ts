import { listCases, type CaseRow } from '@agentor/db';
import { db } from '@/server/infra';
import { tenantNames } from '@/server/platform-data';

export interface ArchiveQuery {
  q?: string;
  customer?: string;
  category?: string;
  supporter?: string;
  period?: string;
}

const PERIODS = { '30d': 30, '90d': 90, '365d': 365 } as const;

/** The archive query (S2), shared by the page and the CSV export. */
export async function archiveRows(userId: string, q: ArchiveQuery): Promise<CaseRow[]> {
  const names = await tenantNames(userId);
  const days = PERIODS[(q.period ?? '30d') as keyof typeof PERIODS] ?? 30;
  const rows = await listCases(db(), userId, names, {
    archived: true,
    ...(q.period === 'all' ? {} : { since: new Date(Date.now() - days * 86_400_000) }),
    ...(q.q ? { q: q.q } : {}),
    ...(q.customer ? { tenantId: q.customer } : {}),
  });
  return rows.filter(
    (r) =>
      (!q.category || r.category === q.category) && (!q.supporter || r.assigneeId === q.supporter),
  );
}
