import { withVat } from '@agentor/core';
import { formatDate, type Locale } from '@agentor/i18n';
import { Responsive } from '@agentor/ui/mobile';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireRole } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { PlanMobile } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('mobile.plan');
  return { title: t('title') };
}

/**
 * MA33 Skift plan, reached from MA15. On a computer plans are compared on Abonnement (D13), so
 * the desktop branch goes there.
 */
export default async function ChangePlanPage() {
  const ctx = await requireRole(['owner']);
  const o = await billingOverview(ctx);
  if (!o) notFound();
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as Locale;
  const renews = o.subscription.currentPeriodEnd;
  const mobile = (
    <PlanMobile
      current={o.plan.id}
      currentName={o.plan.name}
      interval={o.subscription.interval}
      renewsOn={renews ? formatDate(renews, locale) : null}
      plans={[...o.plans]
        .sort((a, b) => b.sortOrder - a.sortOrder)
        .map((p) => ({
          id: p.id,
          name: p.name,
          priceOre: p.priceMonthlyOre,
          sortOrder: p.sortOrder,
          pollingMinutes: p.entitlements.pollingIntervalMinutes,
          transactions: p.entitlements.transactionsPerMonth,
          destinations: p.entitlements.destinationsPerFlow,
          features: p.entitlements.features.included,
          blockers: o.blockers[p.id] ?? [],
          grossOre: withVat(p.priceMonthlyOre).gross,
        }))}
    />
  );
  return (
    <Responsive
      desktop={<DesktopRedirect href="/billing" label={t('compare')} />}
      mobile={mobile}
    />
  );
}
