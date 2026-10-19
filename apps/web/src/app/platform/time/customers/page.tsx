import { getPlatformSettings, timeBetween } from '@agentor/db';
import { formatMinutes, formatMoney, type Locale } from '@agentor/i18n';
import { Banner, Card, EmptyState, Table, Td, Th, Tr } from '@agentor/ui';
import { Clock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { planNames, customersFor } from '@/server/platform-data';

export async function generateMetadata() {
  const t = await getTranslations('platform.time');
  return { title: t('perCustomer') };
}

const monthStartIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

/**
 * Tid pr. kunde: this month's support time per customer, and what will be invoiced. Billable
 * time goes on the customer's next Agentor invoice at the hourly rate Superadmin sets.
 */
export default async function TimePerCustomerPage() {
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.time');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const from = monthStartIso(now);
  const to = monthStartIso(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const [entries, customers, plans, settings] = await Promise.all([
    timeBetween(db(), actor.userId, from, to, false),
    customersFor(actor.userId),
    planNames(),
    getPlatformSettings(db(), actor.userId),
  ]);
  const rows = customers
    .map((c) => {
      const mine = entries.filter((e) => e.tenantId === c.tenantId);
      const billable = mine.filter((e) => e.billable);
      return {
        c,
        minutes: mine.reduce((a, e) => a + e.minutes, 0),
        billable: billable.reduce((a, e) => a + e.minutes, 0),
        invoiced: billable.filter((e) => e.invoiced).reduce((a, e) => a + e.minutes, 0),
      };
    })
    .filter((r) => r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const rate = settings.hourlyRateOre;
  return (
    <PageBody>
      <PageHeader title={t('perCustomerTitle')} subtitle={t('perCustomerIntro')} />
      {rate === null ? (
        <Banner tone="warn">{t('noRate')}</Banner>
      ) : (
        <Banner tone="info">{t('rate', { rate: formatMoney(rate / 100, locale) })}</Banner>
      )}
      <Card padding="none" className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={Clock} title={t('emptyMonth')}>
            {t('emptyMonthBody')}
          </EmptyState>
        ) : (
          <Table aria-label={t('perCustomerTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colCustomer')}</Th>
                <Th>{t('colPlan')}</Th>
                <Th numeric>{t('colTotal')}</Th>
                <Th numeric>{t('colBillable')}</Th>
                <Th numeric>{t('colAmount')}</Th>
                <Th numeric className="pr-5">
                  {t('colInvoiced')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, minutes, billable, invoiced }) => (
                <Tr key={c.tenantId}>
                  <Td className="pl-5">
                    <Link
                      href={`/platform/customers/${c.tenantId}`}
                      className="font-semibold text-fg-1"
                    >
                      {c.name}
                    </Link>
                  </Td>
                  <Td>{(c.planId && plans.get(c.planId)) || '–'}</Td>
                  <Td numeric>{formatMinutes(minutes, locale)}</Td>
                  <Td numeric>{formatMinutes(billable, locale)}</Td>
                  <Td numeric>
                    {rate === null
                      ? '–'
                      : formatMoney(Math.round((billable / 60) * rate) / 100, locale)}
                  </Td>
                  <Td numeric className="pr-5">
                    {formatMinutes(invoiced, locale)}
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
