import { manifestFor } from '@agentor/connectors';
import { formatDate, formatRelative, type Locale } from '@agentor/i18n';
import {
  Card,
  ConnectorLogo,
  EmptyState,
  HeroCurve,
  Icon,
  KpiCard,
  SegmentBar,
  Table,
  Td,
  Th,
  Tr,
} from '@agentor/ui';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  FileWarning,
  FolderX,
  Users,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { NewCaseButton } from '@/components/platform/new-case-button';
import { PeriodPills } from '@/components/platform/period-pills';
import { PageBody, PageHeader, SecondaryBar } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { customersFor, errorsFor } from '@/server/platform-data';
import { Responsive } from '@agentor/ui/mobile';
import { ErrorsMobile } from './mobile';

const DAYS = { '24h': 1, '7d': 7, '30d': 30 } as const;

export async function generateMetadata() {
  const t = await getTranslations('platform.errors');
  return { title: t('title') };
}

/**
 * Fejl på tværs (S7): failures grouped by error code across customers. When the same code hits
 * many customers it is usually a change at the system, not at the customer. Counts only.
 */
export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { actor } = await requireStaff();
  const sp = await searchParams;
  const period = (sp.period && sp.period in DAYS ? sp.period : '24h') as keyof typeof DAYS;
  const t = await getTranslations('platform.errors');
  const locale = (await getLocale()) as Locale;
  const [groups, customers] = await Promise.all([
    errorsFor(actor.userId, DAYS[period]),
    customersFor(actor.userId),
  ]);
  const now = new Date();
  const hit = new Set(groups.flatMap((g) => g.tenantIds));
  const active = customers.filter((c) => c.flows > 0).length || 1;
  const records = groups.reduce((a, g) => a + g.records, 0);
  // Failed records per day over the last week, for the curve on the first card (decision 19).
  const windows = await Promise.all(
    [1, 2, 3, 4, 5, 6, 7].map(async (d) =>
      (await errorsFor(actor.userId, d)).reduce((a, g) => a + g.records, 0),
    ),
  );
  const daily = windows.map((v, i) => (i === 0 ? v : v - windows[i - 1]!)).reverse();
  const newSince = groups.filter((g) => g.previousCustomers === 0).length;
  const noCase = groups.filter((g) => g.caseNumbers.length === 0);
  const rising = groups.find((g) => g.trend === 'rising' && g.customers > 1);
  const describe = (code: string) =>
    t.has(`codes.${code}` as 'codes.ACCOUNT_NOT_FOUND')
      ? t(`codes.${code}` as 'codes.ACCOUNT_NOT_FOUND')
      : '';
  const customerList = customers.map((c) => ({ id: c.tenantId, name: c.name }));

  const desktop = (
    <>
      <SecondaryBar label={t('period')}>
        <PeriodPills
          label={t('period')}
          param="period"
          fallback="24h"
          options={[
            { value: '24h', label: t('p24h') },
            { value: '7d', label: t('p7d') },
            { value: '30d', label: t('p30d') },
          ]}
        />
      </SecondaryBar>
      <PageBody>
        <PageHeader title={t('title')} subtitle={t('intro')} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-kpi-hero-3">
          <KpiCard
            compact
            hero
            icon={FileWarning}
            label={t('statRecords')}
            value={String(records)}
            visual={<HeroCurve compact data={daily} />}
            footer={t(`window.${period}`)}
          />
          <KpiCard
            compact
            icon={CircleX}
            label={t('statTypes')}
            {...(newSince
              ? {
                  growth: {
                    direction: 'up',
                    tone: 'bad',
                    text: t('statNew', { count: newSince }),
                  } as const,
                }
              : {})}
            value={String(groups.length)}
            visual={
              <SegmentBar
                compact
                segments={groups.map((g) => ({
                  value: g.records,
                  tone: g.customers > 1 ? 'error' : 'ink',
                }))}
              />
            }
            footer={t('statTypesSub', { count: newSince })}
          />
          <KpiCard
            compact
            icon={Users}
            iconTone={hit.size > 1 ? 'error' : 'muted'}
            label={t('statCustomers')}
            value={String(hit.size)}
            visual={
              <SegmentBar
                compact
                segments={[
                  { value: hit.size, tone: 'error' },
                  { value: Math.max(0, active - hit.size), tone: 'muted' },
                ]}
              />
            }
            footer={t('statCustomersSub', { pct: Math.round((hit.size / active) * 100) })}
          />
          <KpiCard
            compact
            icon={FolderX}
            label={t('statNoCase')}
            value={String(noCase.length)}
            visual={
              <SegmentBar
                compact
                segments={[
                  { value: noCase.length, tone: 'warn' },
                  { value: Math.max(0, groups.length - noCase.length), tone: 'ink' },
                ]}
              />
            }
            footer={noCase.map((g) => g.code).join(', ') || '–'}
          />
        </div>
        {rising && (
          <div className="flex items-center gap-3 rounded-md bg-error-bg px-4 py-3 text-table">
            <Icon icon={CircleX} size={16} className="text-error-fg" />
            <span>
              <strong>
                {t('risingTitle', {
                  code: rising.code,
                  from: rising.previousCustomers,
                  to: rising.customers,
                })}
              </strong>{' '}
              {t('risingBody')}
            </span>
          </div>
        )}
        <Card padding="none" className="overflow-x-auto">
          {groups.length === 0 ? (
            <EmptyState icon={CircleCheck} title={t('empty')}>
              {t('emptyBody')}
            </EmptyState>
          ) : (
            <Table aria-label={t('title')}>
              <thead>
                <tr>
                  <Th className="pl-5">{t('colCode')}</Th>
                  <Th>{t('colSystem')}</Th>
                  <Th numeric>{t('colCustomers')}</Th>
                  <Th numeric>{t('colRecords')}</Th>
                  <Th>{t('colFirst')}</Th>
                  <Th>{t('colTrend')}</Th>
                  <Th className="pr-5 text-right">{t('colCase')}</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const m = manifestFor(g.connectorId);
                  return (
                    <Tr key={`${g.code}-${g.connectorId}`}>
                      <Td className="whitespace-normal pl-5">
                        <span className="flex flex-col">
                          <span className="font-mono text-mono">{g.code}</span>
                          <span className="text-meta text-fg-2">{describe(g.code)}</span>
                        </span>
                      </Td>
                      <Td>
                        {m ? (
                          <span className="flex items-center gap-2">
                            <ConnectorLogo
                              connector={{ name: m.name, logoUrl: m.logo }}
                              size={24}
                            />
                            {m.name}
                          </span>
                        ) : (
                          '–'
                        )}
                      </Td>
                      <Td numeric className="font-semibold">
                        {t('customers', { count: g.customers })}
                      </Td>
                      <Td numeric>{g.records}</Td>
                      <Td className="text-fg-2">
                        {g.firstSeen.toDateString() === now.toDateString()
                          ? formatRelative(g.firstSeen, now, locale)
                          : formatDate(g.firstSeen, locale)}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <Icon
                            icon={
                              g.trend === 'rising'
                                ? ArrowUpRight
                                : g.trend === 'falling'
                                  ? ArrowDownRight
                                  : ArrowRight
                            }
                            size={14}
                            className={g.trend === 'rising' ? 'text-error-fg' : 'text-fg-2'}
                          />
                          {t(`trend.${g.trend}`)}
                        </span>
                      </Td>
                      <Td className="pr-5 text-right">
                        {g.caseNumbers.length > 0 ? (
                          <Link
                            href={`/platform/cases/archive?q=${encodeURIComponent(g.code)}&period=all`}
                            className="inline-flex h-8 items-center rounded-full px-3 text-table font-semibold text-fg-1 no-underline shadow-ring-chip"
                          >
                            #{g.caseNumbers[0]}
                            {g.caseNumbers.length > 1 ? ` + ${g.caseNumbers.length - 1}` : ''}
                          </Link>
                        ) : (
                          <NewCaseButton customers={customerList} defaultTitle={g.code} size="s" />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </PageBody>
    </>
  );
  // The phone always shows the last 24 hours (MP05).
  const day = period === '24h' ? groups : await errorsFor(actor.userId, 1);
  return (
    <Responsive desktop={desktop} mobile={<ErrorsMobile groups={day} describe={describe} />} />
  );
}
