import { withVat } from '@agentor/core';
import { listPlans, listPlanVersions, listSupportVersions } from '@agentor/db';
import { formatDate, formatNumber, type Locale } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ProductForm,
  type ProductHistoryRow,
  type ProductPlan,
} from '@/components/platform/admin/product-form';
import { PageBody } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';

export async function generateMetadata() {
  const t = await getTranslations('platform.product');
  return { title: t('title') };
}

/**
 * Administration › Produkt (A2): support price and the plans' prices, limits and features. All
 * values are data (support price versions, plans, plan_entitlements); saving makes new versions.
 */
export default async function ProductPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.product');
  const locale = (await getLocale()) as Locale;
  const [plans, supportVersions, planVersions] = await Promise.all([
    listPlans(db()),
    listSupportVersions(db(), actor),
    listPlanVersions(db()),
  ]);
  const support = supportVersions[0];
  const rateInclKr = support ? withVat(support.rateOre).gross / 100 : 800;
  const productPlans: ProductPlan[] = plans
    .filter((p): p is typeof p & { id: ProductPlan['id'] } =>
      ['startup', 'business', 'enterprise'].includes(p.id),
    )
    .map((p) => {
      const e = p.entitlements;
      const on = (k: string) => e.features.included.includes(k);
      return {
        id: p.id,
        name: p.name,
        priceKr: p.priceMonthlyOre / 100,
        transactionsPerMonth: e.transactionsPerMonth,
        seats: e.seats,
        pollingIntervalMinutes: e.pollingIntervalMinutes,
        integrationSets: e.integrationSets,
        payloadRetentionDays: e.payloadRetentionDays,
        trialDays: e.trialDays,
        features: {
          moreDestinations: on('moreDestinations') || e.destinationsPerFlow === null,
          externalUsers: on('externalUsers'),
          sso: on('sso'),
          whiteLabel: on('whiteLabel'),
          supportAudit: on('supportAudit'),
          eanInvoice: on('eanInvoice'),
        },
      };
    });
  const kr = (n: number) => formatNumber(n, locale);
  const names = new Map(plans.map((p) => [p.id, p.name]));
  const date = (d: Date) => formatDate(d, locale);
  const history: ProductHistoryRow[] = [
    ...planVersions.map((v) => ({
      at: v.createdAt,
      row: {
        id: v.id,
        what: names.get(v.planId) ?? v.planId,
        change: t('historyPlan', { price: kr(v.priceMonthlyOre / 100) }),
        appliesTo: t(`applies.${v.appliesTo}`),
        effective: date(v.effectiveFrom),
        by: v.createdByName,
      },
    })),
    ...supportVersions.map((v) => ({
      at: v.createdAt,
      row: {
        id: v.id,
        what: t('supportTitle'),
        change: t('historySupport', {
          price: kr(withVat(v.rateOre).gross / 100),
          rounding: v.roundingMinutes,
        }),
        appliesTo: t('appliesPeriod'),
        effective: date(v.effectiveFrom),
        by: v.createdByName,
      },
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((h) => h.row);
  return (
    <PageBody>
      <ProductForm
        support={{
          rateInclKr,
          roundingMinutes: support?.roundingMinutes ?? 15,
          nonBillable: support?.nonBillable ?? ['agentor_error', 'goodwill'],
        }}
        plans={productPlans}
        history={history}
      />
    </PageBody>
  );
}
