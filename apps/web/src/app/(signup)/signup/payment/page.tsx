import { recommendPlan } from '@agentor/core';
import { getSignupCompany, getSignupOrder, getSignupPaymentStatus, listPlans } from '@agentor/db';
import { formatDate, formatMoney, type Locale } from '@agentor/i18n';
import { Responsive } from '@agentor/ui/mobile';
import { TrustPoints, type OrderSummaryProps } from '@agentor/ui/signup';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { LoginLink, SignupSteps, trustPoints } from '@/components/signup/frame';
import { PaymentStep } from '@/components/signup/payment-step';
import { db } from '@/server/infra';
import { legalLinks } from '@/server/legal';
import { getSignupContext, requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.payment');
  return { title: t('title') };
}

/**
 * SU5 / MS5: order summary in øre (net, VAT 25 %, total today), "Accept af betingelser" and the
 * way to QuickPay's payment window. The company stays in pending_payment until QuickPay's verified
 * Payment callback; ?return=1 only starts the waiting, ?cancelled=1 shows a neutral note.
 */
export default async function SignupPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string; cancelled?: string }>;
}) {
  // Paid while the page was open: show the welcome (SU6) rather than jumping ahead.
  const early = await getSignupContext();
  if (early.tenant?.signupState === 'active' && early.tenant.role === 'owner')
    redirect(early.tenant.onboardingStep === 'done' ? '/' : '/signup/welcome');
  const { session, tenant } = await requireSignupStep('payment');
  const ctx = { tenantId: tenant!.tenantId, userId: session!.user.id };
  const [order, company, plans, paymentStatus] = await Promise.all([
    getSignupOrder(db(), ctx),
    getSignupCompany(db(), ctx),
    listPlans(db()),
    getSignupPaymentStatus(db(), ctx),
  ]);
  if (!order) redirect('/signup/plan');
  const sp = await searchParams;
  const t = await getTranslations('signupFlow.payment');
  const tp = await getTranslations('signupFlow.plan');
  const locale = (await getLocale()) as Locale;
  const money = (ore: number) => formatMoney(ore / 100, locale);
  const year = order.interval === 'year';
  const period = year ? tp('periodYear') : tp('periodMonth');
  const recommended = recommendPlan(plans, {
    ordersPerMonth: company?.ordersPerMonth,
    systemCount: company?.chosenConnectors.length ?? 0,
  });
  const date = formatDate(order.renewsAt, locale);
  const summary = (mobile: boolean): OrderSummaryProps => ({
    title: t('orderTitle', { plan: order.planName, period }),
    company: order.cvr
      ? t('company', { name: order.companyName, cvr: order.cvr })
      : order.companyName,
    badge: order.planId === recommended ? t('recommended') : undefined,
    lines: [
      {
        label: year
          ? t('lineYear', { plan: order.planName })
          : t('lineMonth', { plan: order.planName }),
        amount: money(order.netOre),
      },
      { label: t('vat'), amount: money(order.vatOre) },
    ],
    total: { label: t('total'), amount: money(order.totalOre) },
    // The 14-day notice is sent for yearly renewals (PLAN-SIGNUP Q13).
    note: [
      year ? t('renewsYear', { date }) : t('renewsMonth', { date }),
      !mobile && order.billingEmail ? t('invoiceTo', { email: order.billingEmail }) : null,
    ]
      .filter(Boolean)
      .join(' '),
  });
  const status =
    paymentStatus === 'failed'
      ? 'failed'
      : sp.return === '1' || paymentStatus === 'waiting'
        ? 'waiting'
        : sp.cancelled === '1'
          ? 'cancelled'
          : 'idle';
  const links = legalLinks();
  const docs = { subscriptionTerms: links.subscriptionTerms, privacy: links.privacy };
  const pay = money(order.totalOre);
  return (
    <Responsive
      desktop={
        <PaymentStep
          order={summary(false)}
          pay={pay}
          docs={docs}
          initialStatus={status}
          topRight={<LoginLink />}
          step={<SignupSteps current={4} />}
          points={<TrustPoints points={await trustPoints()} />}
          panelPoints={[t('points.active'), t('points.change'), t('points.support')]}
        />
      }
      mobile={
        <PaymentStep
          mobile
          order={summary(true)}
          pay={pay}
          docs={docs}
          initialStatus={status}
          topRight={<LoginLink />}
          step={<SignupSteps current={4} mobile />}
        />
      }
    />
  );
}
