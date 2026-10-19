import { listAudit, listMembers } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import { Avatar, Button, Card, EmptyState, Icon, Table, Td, Th, Tr, cn } from '@agentor/ui';
import { Download, History, LifeBuoy } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { AuditFilters } from './audit-filters';
import { describeObject, toFilter, type AuditQuery } from './filters';

export async function generateMetadata() {
  const t = await getTranslations('audit');
  return { title: t('title') };
}

/** Audit-log (D12-Auditlog): append-only; support rows are tinted and tagged. */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditQuery>;
}) {
  const ctx = await requireRole(['owner', 'admin']);
  const q = await searchParams;
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [rows, members] = await Promise.all([
    listAudit(db(), c, toFilter(q, 51)),
    listMembers(db(), c),
  ]);
  const hasMore = rows.length > 50;
  const entries = rows.slice(0, 50);
  const t = await getTranslations('audit');
  const nav = await getTranslations('nav');
  const locale = (await getLocale()) as Locale;
  const params = new URLSearchParams(
    Object.entries(q).filter(([k, v]) => k !== 'before' && typeof v === 'string') as [
      string,
      string,
    ][],
  );
  const nextHref = hasMore
    ? `?${new URLSearchParams({ ...Object.fromEntries(params), before: entries.at(-1)!.createdAt.toISOString() })}`
    : null;
  const actionLabel = (action: string) => {
    const key = `actions.${action.replace('.', '_')}`;
    return t.has(key as 'actions.member_invited') ? t(key as 'actions.member_invited') : action;
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow={nav('settings')}
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button variant="secondary" asChild>
            <a href={`/settings/audit-log/export?${params}`}>
              <Icon icon={Download} size={16} />
              {t('export')}
            </a>
          </Button>
        }
      />
      <AuditFilters members={members.map((m) => ({ id: m.userId, name: m.name }))} query={q} />
      <Card padding="none" className="overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState icon={History} title={t('empty')}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="pl-5">{t('colTime')}</Th>
                <Th>{t('colWho')}</Th>
                <Th>{t('colAction')}</Th>
                <Th>{t('colObject')}</Th>
                <Th>{t('colIp')}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const support = e.actorKind === 'support';
                return (
                  <Tr key={e.id} className={cn(support && 'bg-navy-tint')}>
                    <Td className="pl-5 tabular text-fg-2">
                      {formatDate(e.createdAt, locale).replace(/ \d{4}$/, '')}{' '}
                      {formatTime(e.createdAt, locale)}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2.5">
                        {support ? (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-navy px-2 text-micro font-semibold text-on-navy">
                            <Icon icon={LifeBuoy} size={14} />
                            {t('supportBadge')}
                          </span>
                        ) : e.actorKind === 'system' ? (
                          <Avatar name="· ·" />
                        ) : (
                          <Avatar name={e.actorName ?? '?'} />
                        )}
                        <span className={cn(e.actorKind === 'system' && 'text-fg-2')}>
                          {e.actorKind === 'system' ? t('system') : e.actorName}
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-normal">{actionLabel(e.action)}</Td>
                    <Td className="whitespace-normal text-fg-2">{describeObject(e)}</Td>
                    <Td className="tabular text-fg-2">{e.ip ?? '–'}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {nextHref && (
        <div className="flex justify-center">
          <ButtonLink variant="secondary" href={nextHref} scroll={false}>
            {t('loadMore')}
          </ButtonLink>
        </div>
      )}
    </PageBody>
  );
}
