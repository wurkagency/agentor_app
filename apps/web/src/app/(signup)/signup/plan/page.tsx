import { recommendPlan, subscriptionPriceOre, YEARLY_MONTHS } from '@agentor/core';
import { getSignupCompany, getSignupOrder, listPlans, type PlanInfo } from '@agentor/db';
import { formatMoney, formatNumber, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { LogoImg, TrustPanel, TrustPoints } from '@agentor/ui/signup';
import { Bell, FlaskConical, Headset, KeyRound, RotateCcw, ScrollText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { logos, SU4_LOGOS } from '@/components/signup/catalogue';
import { LoginLink, SignupSteps, trustPoints } from '@/components/signup/frame';
import { PlanStep, type PlanView } from '@/components/signup/plan-step';
import { db } from '@/server/infra';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.plan');
  return { title: t('title') };
}

/** SU4 / MS4: plan and period. Prices, limits and the recommendation are data (plan_entitlements). */
export default async function SignupPlanPage() {
  const { session, tenant } = await requireSignupStep('plan');
  const ctx = { tenantId: tenant!.tenantId, userId: session!.user.id };
  const [plans, company, order] = await Promise.all([
    listPlans(db()),
    getSignupCompany(db(), ctx),
    getSignupOrder(db(), ctx),
  ]);
  const t = await getTranslations('signupFlow.plan');
  const tc = await getTranslations('signupFlow.company');
  const locale = (await getLocale()) as Locale;
  const recommended = recommendPlan(plans, {
    ordersPerMonth: company?.ordersPerMonth,
    systemCount: company?.chosenConnectors.length ?? 0,
  });
  const views = plans.map((p) => planView(p, plans, t, tc, locale));
  const initialPlan =
    tenant!.signupState === 'pending_payment' && order
      ? order.planId
      : (recommended ?? plans[1]?.id ?? plans[0]!.id);
  const initialInterval =
    tenant!.signupState === 'pending_payment' && order ? order.interval : 'year';
  const badge = YEARLY_MONTHS === 10 ? t('free') : undefined;
  const all = [
    [FlaskConical, 'test'],
    [RotateCcw, 'retry'],
    [Bell, 'push'],
    [ScrollText, 'audit'],
    [KeyRound, 'keys'],
    [Headset, 'support'],
  ] as const;
  return (
    <Responsive
      desktop={
        <PlanStep
          plans={views}
          recommended={recommended}
          initialPlan={initialPlan}
          initialInterval={initialInterval}
          yearlyBadge={badge}
          topRight={<LoginLink />}
          step={<SignupSteps current={3} />}
          panel={
            <TrustPanel
              label={t('panelTitle')}
              title={t('panelTitle')}
              lead={t('panelLead')}
              points={<TrustPoints points={await trustPoints()} />}
            >
              <ul className="m-0 grid max-w-signup-panel list-none grid-cols-2 gap-x-6 gap-y-4 p-0">
                {all.map(([icon, key]) => (
                  <li key={key} className="flex items-start gap-2.5">
                    <span className="grid size-8 flex-none place-items-center rounded-field bg-lime-tint text-primary">
                      <Icon icon={icon} size={16} />
                    </span>
                    <span className="flex flex-col leading-snug">
                      <strong className="text-body">{t(`all.${key}`)}</strong>
                      <span className="text-m-note text-on-navy-soft">{t(`all.${key}Text`)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
                {logos(SU4_LOGOS).map((l) => (
                  <li
                    key={l.id}
                    className="grid size-10 place-items-center rounded-sm bg-white shadow-tile"
                  >
                    <LogoImg logo={l} size="sm" />
                  </li>
                ))}
              </ul>
            </TrustPanel>
          }
        />
      }
      mobile={
        <PlanStep
          mobile
          plans={views}
          recommended={recommended}
          initialPlan={initialPlan}
          initialInterval={initialInterval}
          yearlyBadge={badge}
          topRight={<LoginLink />}
          step={<SignupSteps current={3} mobile />}
        />
      }
    />
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'signupFlow.plan'>>>;
type TC = Awaited<ReturnType<typeof getTranslations<'signupFlow.company'>>>;

/** "790 kr." for whole kroner, "65,83 kr." otherwise. Amounts in øre. */
function kr(ore: number, locale: Locale) {
  return ore % 100 === 0
    ? `${formatNumber(ore / 100, locale)} kr.`
    : formatMoney(ore / 100, locale);
}

const BUCKET_LABEL = { lt100: 'lt100', '100-1000': 'mid', gt1000: 'gt1000' } as const;
const BASE_FEATURES = [
  'transactions',
  'polling',
  'destinations3',
  'moreDestinations',
  'supportAudit',
];

function planView(p: PlanInfo, all: PlanInfo[], t: T, tc: TC, locale: Locale): PlanView {
  const e = p.entitlements;
  const month = subscriptionPriceOre({ monthlyOre: p.priceMonthlyOre, interval: 'month' });
  const year = subscriptionPriceOre({ monthlyOre: p.priceMonthlyOre, interval: 'year' });
  // [ANTAL] stays until plan_entitlements gives a number (README "Kendte pladsholdere").
  const tx =
    e.transactionsPerMonth === null ? '[ANTAL]' : formatNumber(e.transactionsPerMonth, locale);
  const maxDest = Math.max(
    ...all.map((x) => x.entitlements.destinationsPerFlow).filter((d): d is number => d !== null),
  );
  const destinations =
    e.destinationsPerFlow === null
      ? t('moreDestinations', { count: maxDest })
      : t('destinations', { count: e.destinationsPerFlow });
  const polling =
    e.pollingIntervalMinutes === 1
      ? t('pollingEveryMinute')
      : t('pollingEvery', { minutes: e.pollingIntervalMinutes });
  // One more line from the plan's own features; a plan without any shows the next plan's in grey.
  const extra = (x: PlanInfo) =>
    x.entitlements.features.included.filter((f) => !BASE_FEATURES.includes(f) && f in FEATURE);
  let featureLine: { text: string; included: boolean } | null = null;
  const own = extra(p);
  if (own.length) featureLine = { text: joinFeatures(own, t), included: true };
  else {
    const next = all.slice(all.indexOf(p) + 1).find((x) => extra(x).length);
    if (next) featureLine = { text: joinFeatures(extra(next).slice(0, 1), t), included: false };
  }
  const bucket = e.recommendedForOrders[0] as keyof typeof BUCKET_LABEL | undefined;
  const orders = bucket && BUCKET_LABEL[bucket] ? tc(BUCKET_LABEL[bucket]) : null;
  const fit = orders
    ? e.recommendedForSystems === null
      ? t('fitOrders', { orders })
      : t('fit', { orders, systems: e.recommendedForSystems })
    : undefined;
  return {
    id: p.id,
    name: p.name,
    price: { month: kr(month, locale), year: kr(year, locale) },
    yearPerMonth: formatMoney(Math.round(year / 12) / 100, locale),
    lines: [
      { text: t('transactions', { count: tx }), included: true },
      { text: polling, included: true },
      { text: destinations, included: true },
      ...(featureLine ? [featureLine] : []),
    ],
    summary:
      e.destinationsPerFlow === null
        ? [
            t('moreDestinationsShort'),
            ...own.slice(0, 1).map((f) => t(`features.${f as 'sso'}`)),
          ].join(' · ')
        : `${t('transactionsShort', { count: tx })} · ${
            e.pollingIntervalMinutes === 1
              ? t('pollingShortMinute')
              : t('pollingShort', { minutes: e.pollingIntervalMinutes })
          }`,
    fit,
  };
}

const FEATURE = { externalUsers: true, sso: true, whiteLabel: true } as const;

function joinFeatures(features: string[], t: T) {
  const words = features.map((f) => t(`features.${f as keyof typeof FEATURE}`));
  if (words.length < 2) return words[0] ?? '';
  const [first, ...rest] = words;
  return `${first} ${t('and')} ${rest.join(', ')}`;
}
