import { recommendPlan } from '@agentor/core';
import { getBillingOverview, getCompany } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { OnboardingCard } from '../stepper';
import { PlanStep } from './plan-step';

export async function generateMetadata() {
  const t = await getTranslations('onboarding');
  return { title: t('planTitle') };
}

/** Onboarding step 2 (D14-Onboarding-2): plan and card via QuickPay. */
export default async function OnboardingPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const ctx = await requireRole(['owner']);
  if (ctx.tenant.onboardingCompleted) redirect('/');
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [overview, company] = await Promise.all([getBillingOverview(db(), c), getCompany(db(), c)]);
  if (!overview) redirect('/');
  const { card } = await searchParams;
  const t = await getTranslations('onboarding');
  const recommended = recommendPlan(overview.plans, company?.ordersPerMonth);
  return (
    <OnboardingCard step={2} title={t('planTitle')} intro={t('planIntro')}>
      <PlanStep
        plans={overview.plans.map((p) => ({
          id: p.id,
          name: p.name,
          priceOre: p.priceMonthlyOre,
          pollingMinutes: p.entitlements.pollingIntervalMinutes,
          transactions: p.entitlements.transactionsPerMonth,
          destinations: p.entitlements.destinationsPerFlow,
          features: p.entitlements.features.included,
        }))}
        initialPlan={overview.plan.id}
        recommended={recommended}
        ordersPerMonth={company?.ordersPerMonth ?? null}
        card={
          overview.subscription.hasCard
            ? {
                brand: overview.subscription.cardBrand,
                last4: overview.subscription.cardLast4,
              }
            : null
        }
        returning={card === 'return'}
        cancelled={card === 'cancelled'}
      />
    </OnboardingCard>
  );
}
