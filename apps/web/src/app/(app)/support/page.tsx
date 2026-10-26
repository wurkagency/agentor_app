import { listCustomerCases } from '@agentor/db';
import { formatRelative, type Locale } from '@agentor/i18n';
import { Card, EmptyState, Icon, Table, Td, Th, Tr } from '@agentor/ui';
import { LifeBuoy, Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';

export async function generateMetadata() {
  const t = await getTranslations('support');
  return { title: t('title') };
}

/** Mine sager: the company's support cases and where they stand. */
export default async function SupportPage() {
  const ctx = await requireCustomerArea();
  const t = await getTranslations('support');
  const locale = (await getLocale()) as Locale;
  const cases = await listCustomerCases(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
    name: ctx.user.name,
  });
  const now = new Date();
  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <ButtonLink variant="primary" size="l" href="/support/new">
            <Icon icon={Plus} size={16} />
            {t('new')}
          </ButtonLink>
        }
      />
      <Card padding="none" className="overflow-x-auto">
        {cases.length === 0 ? (
          <EmptyState icon={LifeBuoy} title={t('empty')}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('title')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCase')}</Th>
                <Th>{t('colTitle')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th>{t('colBy')}</Th>
                <Th className="pr-5">{t('colUpdated')}</Th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <Tr key={c.id}>
                  <Td className="pl-5 font-mono text-mono">#{c.number}</Td>
                  <Td>
                    <Link href={`/support/${c.id}`} className="font-semibold text-fg-1">
                      {c.title}
                    </Link>
                  </Td>
                  <Td>{t(`status.${c.status}`)}</Td>
                  <Td>{c.createdByName}</Td>
                  <Td className="pr-5 text-fg-2">{formatRelative(c.updatedAt, now, locale)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
