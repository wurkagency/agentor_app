import { getPlatformSettings, listPlans } from '@agentor/db';
import { formatMoney, type Locale } from '@agentor/i18n';
import { Card, CardHeader, Table, Td, Th, Tr } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { RulesForm } from '@/components/platform/staff-controls';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.settings');
  return { title: t('title') };
}

/**
 * Platformindstillinger (Superadmin): the hourly rate for billable support time and the access
 * rules. Not drawn on the boards; plans are read-only here until their screen exists (FOLLOW-UP).
 */
export default async function PlatformSettingsPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.settings');
  const locale = (await getLocale()) as Locale;
  const [settings, plans] = await Promise.all([getPlatformSettings(db(), actor.userId), listPlans(db())]);
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
                <Th numeric className="pr-5">
                  {t('colPrice')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <Tr key={p.id}>
                  <Td className="pl-5 font-semibold">{p.name}</Td>
                  <Td numeric className="pr-5">
                    {formatMoney(p.priceMonthlyOre / 100, locale)}
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
