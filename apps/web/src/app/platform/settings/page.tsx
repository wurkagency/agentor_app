import { getPlatformSettings, listPlans } from '@agentor/db';
import { formatMoney, type Locale } from '@agentor/i18n';
import { Card, CardHeader, Table, Td, Th, Tr } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlanEditButton } from '@/components/platform/plan-editor';
import { RulesForm } from '@/components/platform/staff-controls';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.settings');
  return { title: t('title') };
}

/**
 * Platformindstillinger (Superadmin): the hourly rate for billable support time (README decision
 * 18: 640 kr. ex. VAT), the bookkeeper's e-mail for the monthly report and the access rules, and the plans' price and limits. Not drawn on the boards.
 */
export default async function PlatformSettingsPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.settings');
  const locale = (await getLocale()) as Locale;
  const [settings, plans] = await Promise.all([
    getPlatformSettings(db(), actor.userId),
    listPlans(db()),
  ]);
  return (
    <PageBody>
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <CardHeader title={t('supportTitle')} meta={t('supportMeta')} />
          <RulesForm
            warnConcurrent={settings.warnConcurrentGrants}
            hourlyRateKr={settings.hourlyRateOre === null ? null : settings.hourlyRateOre / 100}
            showRate
            bookkeeperEmail={settings.bookkeeperEmail}
          />
        </Card>
        <Card padding="none" className="overflow-x-auto">
          <div className="px-5 pb-2 pt-5">
            <CardHeader title={t('plansTitle')} meta={t('plansMeta')} />
          </div>
          <Table aria-label={t('plansTitle')}>
            <thead>
              <tr>
                <Th className="pl-5">{t('colPlan')}</Th>
                <Th numeric>{t('colPrice')}</Th>
                <Th numeric>{t('colSeats')}</Th>
                <Th numeric>{t('colTransactions')}</Th>
                <Th className="pr-5" aria-label={t('colEdit')} />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <Tr key={p.id}>
                  <Td className="pl-5 font-semibold">{p.name}</Td>
                  <Td numeric>{formatMoney(p.priceMonthlyOre / 100, locale)}</Td>
                  <Td numeric>{p.entitlements.seats ?? t('unlimited')}</Td>
                  <Td numeric>{p.entitlements.transactionsPerMonth ?? t('unlimited')}</Td>
                  <Td className="pr-5 text-right">
                    <PlanEditButton
                      plan={{
                        id: p.id,
                        name: p.name,
                        priceKr: p.priceMonthlyOre / 100,
                        seats: p.entitlements.seats,
                        transactionsPerMonth: p.entitlements.transactionsPerMonth,
                        integrationSets: p.entitlements.integrationSets,
                        destinationsPerFlow: p.entitlements.destinationsPerFlow,
                        pollingIntervalMinutes: p.entitlements.pollingIntervalMinutes,
                      }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </PageBody>
  );
}
