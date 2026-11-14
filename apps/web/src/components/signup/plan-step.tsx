'use client';

import { Banner } from '@agentor/ui';
import {
  BillingPeriodToggle,
  MobileSignupShell,
  PlanCard,
  SignupButton,
  SignupHeading,
  SignupShell,
} from '@agentor/ui/signup';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { chooseSignupPlanAction } from '@/app/(signup)/actions';

/** One plan as the plan step shows it, already formatted on the server from plan_entitlements. */
export interface PlanView {
  id: string;
  name: string;
  /** Per period: "790 kr." for a year, "79 kr." for a month. */
  price: { month: string; year: string };
  /** "65,83 kr." (yearly price / 12). */
  yearPerMonth: string;
  lines: { text: string; included: boolean }[];
  /** "100 transaktioner/md. · hvert 15. min." for the collapsed row. */
  summary: string;
  fit?: string | undefined;
}

export function PlanStep({
  mobile = false,
  plans,
  recommended,
  initialPlan,
  initialInterval,
  yearlyBadge,
  topRight,
  step,
  panel,
}: {
  mobile?: boolean;
  plans: PlanView[];
  recommended: string | null;
  initialPlan: string;
  initialInterval: 'month' | 'year';
  /** "2 måneder gratis", only while a year costs 10 months. */
  yearlyBadge?: string | undefined;
  topRight: ReactNode;
  step: ReactNode;
  panel?: ReactNode;
}) {
  const t = useTranslations('signupFlow.plan');
  const [plan, setPlan] = useState(initialPlan);
  const [interval, setInterval] = useState(initialInterval);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = plans.find((p) => p.id === plan) ?? plans[0]!;
  const year = interval === 'year';

  const submit = () =>
    start(async () => {
      const r = await chooseSignupPlanAction({ planId: plan, interval });
      if (r && !r.ok)
        setError(t(r.error === 'UNKNOWN_PLAN' ? 'errors.UNKNOWN_PLAN' : 'errors.generic'));
    });

  // Mobile: the chosen plan unfolded (the recommended one at first), the others as rows (decision 22).
  const ordered = mobile ? [chosen, ...plans.filter((p) => p.id !== chosen.id)] : plans;
  const cards = ordered.map((p) => (
    <PlanCard
      key={p.id}
      name_="plan"
      mobile={mobile}
      variant={!mobile || compare || p.id === chosen.id ? 'expanded' : 'collapsed'}
      name={p.name}
      price={year ? p.price.year : p.price.month}
      per={
        mobile && p.id !== chosen.id && !compare
          ? year
            ? t('perYearShort')
            : t('perMonthShort')
          : year
            ? t('perYear')
            : t('perMonth')
      }
      equivalent={
        year
          ? mobile
            ? t('equivalentShort', { amount: p.yearPerMonth })
            : t('equivalent', { amount: p.yearPerMonth })
          : undefined
      }
      lines={p.lines}
      fit={p.id === recommended ? p.fit : undefined}
      badge={p.id === recommended ? t('recommended') : undefined}
      selected={p.id === plan}
      onSelect={() => setPlan(p.id)}
      summary={p.summary}
    />
  ));

  const body = (
    <>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={mobile ? t('leadMobile') : t('lead')}
      />
      {error && <Banner tone="error">{error}</Banner>}
      <BillingPeriodToggle
        value={interval}
        onChange={setInterval}
        label={t('period')}
        monthly={t('monthly')}
        yearly={t('yearly')}
        badge={yearlyBadge}
      />
      <div
        role="radiogroup"
        aria-label={t('title')}
        className={mobile ? 'flex flex-col gap-2.5 pt-2' : 'grid grid-cols-3 gap-3.5 pt-1.5'}
      >
        {cards}
      </div>
      {mobile && (
        <button
          type="button"
          onClick={() => setCompare((c) => !c)}
          aria-expanded={compare}
          className="cursor-pointer self-center border-0 bg-transparent p-0 font-sans text-meta font-semibold text-fg-1 underline"
        >
          {compare ? t('hideCompare') : t('compare')}
        </button>
      )}
      <div className={mobile ? 'mt-auto flex gap-2.5' : 'flex gap-2.5'}>
        <SignupButton
          asChild
          variant="secondary"
          mobile={mobile}
          className={mobile ? 'px-5.5' : ''}
        >
          <Link href="/signup/company">{t('back')}</Link>
        </SignupButton>
        <SignupButton mobile={mobile} grow loading={pending} onClick={submit}>
          {pending
            ? t('saving')
            : mobile
              ? t('continueMobile', { plan: chosen.name })
              : t('continue', {
                  plan: chosen.name,
                  period: year ? t('periodYear') : t('periodMonth'),
                })}
        </SignupButton>
      </div>
    </>
  );

  if (mobile)
    return (
      <MobileSignupShell topRight={topRight} step={step}>
        {body}
      </MobileSignupShell>
    );
  return (
    <SignupShell topRight={topRight} step={step} panel={panel}>
      {body}
    </SignupShell>
  );
}
