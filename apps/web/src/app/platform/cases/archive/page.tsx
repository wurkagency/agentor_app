import { listStaff } from '@agentor/db';
import { formatDate, formatMinutes, type Locale } from '@agentor/i18n';
import { Avatar, Card, EmptyState, Icon, Table, Td, Th, Tr } from '@agentor/ui';
import { Archive, Download } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { QueryFilters } from '@/components/platform/query-filters';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { initials, tenantNames } from '@/server/platform-data';
import { Responsive } from '@agentor/ui/mobile';
import { ArchiveMobile } from './mobile';
import { archiveRows, type ArchiveQuery } from './rows';

export async function generateMetadata() {
  const t = await getTranslations('platform.archive');
  return { title: t('title') };
}

/** Arkiv (S2): resolved and closed cases, searchable in title, resolution and notes. */
export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<ArchiveQuery>;
}) {
  const { actor } = await requireStaff();
  const q = await searchParams;
  const t = await getTranslations('platform.archive');
  const tc = await getTranslations('platform.case');
  const locale = (await getLocale()) as Locale;
  const [rows, names, staff] = await Promise.all([
    archiveRows(actor.userId, q),
    tenantNames(actor.userId),
    listStaff(db(), actor),
  ]);
  const total = rows.reduce((a, r) => a + r.minutes, 0);
  const shown = rows.slice(0, 100);
  const params = new URLSearchParams(
    Object.entries(q).filter(([, v]) => typeof v === 'string') as [string, string][],
  );

  const desktop = (
    <PageBody>
      <PageHeader
        title={t('title')}
        subtitle={t('intro', { count: rows.length })}
        actions={
          <ButtonLink variant="secondary" href={`/platform/cases/archive/export?${params}`}>
            <Icon icon={Download} size={16} />
            {t('export')}
          </ButtonLink>
        }
      />
      <QueryFilters
        searchLabel={t('search')}
        filters={[
          {
            key: 'customer',
            label: t('customer'),
            allLabel: t('all'),
            options: [...names].map(([value, label]) => ({ value, label })),
          },
          {
            key: 'category',
            label: t('category'),
            allLabel: t('all'),
            options: [
              'error',
              'mapping',
              'connection',
              'setup',
              'subscription',
              'wish',
              'question',
            ].map((k) => ({
              value: k,
              label: tc(`category.${k}`),
            })),
          },
          {
            key: 'supporter',
            label: t('supporter'),
            allLabel: t('all'),
            options: staff.map((s) => ({ value: s.userId, label: s.name })),
          },
          {
            key: 'period',
            label: t('period'),
            allLabel: t('last30'),
            options: [
              { value: '90d', label: t('last90') },
              { value: '365d', label: t('last365') },
              { value: 'all', label: t('allTime') },
            ],
          },
        ]}
      />
      <Card padding="none" className="overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState icon={Archive} title={t('empty')}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('title')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCase')}</Th>
                <Th>{t('colTitle')}</Th>
                <Th>{t('colCustomer')}</Th>
                <Th>{t('colCategory')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th>{t('colSupporter')}</Th>
                <Th>{t('colCreated')}</Th>
                <Th>{t('colResolved')}</Th>
                <Th numeric className="pr-5">
                  {t('colTime')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.id}>
                  <Td className="pl-5 font-mono text-mono">#{r.number}</Td>
                  <Td className="whitespace-normal">
                    <Link
                      href={`/platform/cases/${r.id}`}
                      className="flex flex-col text-fg-1 no-underline"
                    >
                      <span className="font-semibold">{r.title}</span>
                      {r.resolution && <span className="text-meta text-fg-2">{r.resolution}</span>}
                    </Link>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="grid h-5 min-w-6 place-items-center rounded-xs bg-bg-base px-1 text-nano font-semibold shadow-ring-chip">
                        {initials(r.tenantName)}
                      </span>
                      {r.tenantName}
                    </span>
                  </Td>
                  <Td>{tc(`category.${r.category}`)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <span className="size-1.5 rounded-full bg-fg-2" />
                      {tc(`status.${r.status}`)}
                    </span>
                  </Td>
                  <Td>
                    {r.assigneeName ? <Avatar name={r.assigneeName} size={28} tone="navy" /> : '–'}
                  </Td>
                  <Td className="text-fg-2">
                    {formatDate(r.createdAt, locale).replace(/ \d{4}$/, '')}
                  </Td>
                  <Td className="text-fg-2">
                    {r.resolvedAt ? formatDate(r.resolvedAt, locale).replace(/ \d{4}$/, '') : '–'}
                  </Td>
                  <Td numeric className="pr-5">
                    {formatMinutes(r.minutes, locale)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="m-0 border-t border-border px-5 py-3 text-meta text-fg-2">
          {t('footer', {
            shown: shown.length,
            total: rows.length,
            time: formatMinutes(total, locale),
          })}
        </p>
      </Card>
    </PageBody>
  );
  return (
    <Responsive
      desktop={desktop}
      mobile={
        <ArchiveMobile
          rows={shown}
          count={rows.length}
          totalMinutes={total}
          query={q}
          customers={[...names].map(([value, label]) => ({ value, label }))}
          staff={staff.map((s) => ({ value: s.userId, label: s.name }))}
        />
      }
    />
  );
}
