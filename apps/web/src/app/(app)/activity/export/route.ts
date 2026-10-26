import { listActivity } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { requireAppContext } from '@/server/auth/session';
import { viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { toActivityFilter, type ActivityQuery } from '../query';

export const dynamic = 'force-dynamic';

/** CSV-safe cell: quoted, quotes doubled, formula injection neutralised (=, +, -, @). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV of the activity log honouring the current filters (produktspecifikation §7.6).
 * Semicolon-separated with a BOM for Danish Excel; amounts in kroner with a decimal comma.
 */
export async function GET(request: Request) {
  const ctx = await requireAppContext();
  const q = Object.fromEntries(new URL(request.url).searchParams) as ActivityQuery;
  const rows = await listActivity(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    toActivityFilter(q, 1000),
  );
  const views = await viewsFor(ctx, 30);
  const t = await getTranslations('activity');
  const header = [
    t('col.time'),
    t('col.flow'),
    t('col.route'),
    t('col.record'),
    t('col.outcome'),
    t('col.amount'),
  ];
  const lines = rows.map((r) => {
    const v = views.find((x) => x.id === r.flowId);
    const route = v?.routes.find((x) => x.id === r.routeId);
    return [
      r.createdAt.toISOString(),
      v?.name ?? '',
      route ? `${route.source} → ${route.destination}` : r.routeId,
      r.label,
      r.mode === 'test' ? `test:${r.outcome}` : r.outcome,
      r.amountOre === null ? '' : (r.amountOre / 100).toFixed(2).replace('.', ','),
    ]
      .map(cell)
      .join(';');
  });
  const body = `\uFEFF${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="aktivitet-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
