import { listAudit } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { describeObject, toFilter } from '../filters';

export const dynamic = 'force-dynamic';

/** CSV-safe cell: quoted, quotes doubled, and formula injection neutralised (=, +, -, @). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV export of the audit log (produktspecifikation §7.8), honouring the current filters.
 * Semicolon-separated with a BOM so Danish Excel opens it correctly.
 */
export async function GET(request: Request) {
  const ctx = await requireRole(['owner', 'admin']);
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await listAudit(
    db(),
    { tenantId: ctx.tenant.tenantId, userId: ctx.user.id },
    toFilter(q, 500),
  );
  const t = await getTranslations('audit');
  const header = [t('colTime'), t('colWho'), t('colAction'), t('colObject'), t('colIp')];
  const lines = rows.map((e) =>
    [
      e.createdAt.toISOString(),
      e.actorKind === 'system' ? t('system') : e.actorName,
      e.action,
      describeObject(e),
      e.ip,
    ]
      .map(cell)
      .join(';'),
  );
  const body = `\uFEFF${header.map(cell).join(';')}\r\n${lines.join('\r\n')}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="agentor-audit-log-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
