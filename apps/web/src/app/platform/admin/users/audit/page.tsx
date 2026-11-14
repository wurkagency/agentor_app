import { listPlatformAudit } from '@agentor/db';
import { formatDate, formatTime, type Locale } from '@agentor/i18n';
import { Card, EmptyState, Table, Td, Th, Tr } from '@agentor/ui';
import { History } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.users');
  return { title: t('audit') };
}

/** Platform-audit-log (P6): changes to staff and platform settings. */
export default async function PlatformAuditPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.users');
  const locale = (await getLocale()) as Locale;
  const rows = await listPlatformAudit(db(), actor);
  const label = (a: string) => {
    const key = `auditActions.${a.replace('.', '_')}`;
    return t.has(key as 'auditActions.staff_saved') ? t(key as 'auditActions.staff_saved') : a;
  };
  return (
    <PageBody>
      <PageHeader title={t('audit')} subtitle={t('auditIntro')} />
      <Card padding="none" className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={History} title={t('auditEmpty')}>
            {t('auditEmptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('audit')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colTime')}</Th>
                <Th>{t('colWho')}</Th>
                <Th>{t('colAction')}</Th>
                <Th className="pr-5">{t('colDetail')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="pl-5 tabular text-fg-2">
                    {formatDate(r.createdAt, locale)} {formatTime(r.createdAt, locale)}
                  </Td>
                  <Td>{r.actorName}</Td>
                  <Td>{label(r.action)}</Td>
                  <Td className="whitespace-normal pr-5 font-mono text-mono text-fg-2">
                    {Object.entries(r.detail)
                      .filter(([k]) => k !== 'userId')
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(' · ')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
