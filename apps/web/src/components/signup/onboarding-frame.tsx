import type { OnboardingStep } from '@agentor/core';
import { StepProgress } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { skipOnboardingAction } from '@/app/(signup)/onboarding/actions';

const STEPS = ['webshop', 'accounting', 'template', 'test'] as const;

/** "Opsætning 2 af 4" (OB top, MO bottom). */
export async function OnboardingSteps({
  step,
  mobile = false,
}: {
  step: (typeof STEPS)[number];
  mobile?: boolean;
}) {
  const t = await getTranslations('onboardingFlow');
  const current = STEPS.indexOf(step) + 1;
  const labels = STEPS.map((s) => t(`steps.${s}`));
  const name = labels[current - 1]!;
  return (
    <StepProgress
      variant={mobile ? 'bottom' : 'top'}
      current={current}
      labels={labels}
      counter={t('counter', { n: current })}
      next={current < 4 ? t('next', { name: labels[current]! }) : t('last')}
      label={mobile ? t('navLabelMobile', { n: current, name }) : t('navLabel', { n: current })}
    />
  );
}

/** "Spring over og gå til overblik" (every onboarding step), a real form so it works without JS. */
export async function SkipLink({
  step,
  mobile = false,
}: {
  step: OnboardingStep;
  mobile?: boolean;
}) {
  const t = await getTranslations('onboardingFlow');
  return (
    <form action={skipOnboardingAction.bind(null, step)}>
      <button
        type="submit"
        className="touch-target cursor-pointer border-0 bg-transparent p-0 font-sans text-table font-semibold text-fg-1"
      >
        {mobile ? t('skipShort') : t('skip')}
      </button>
    </form>
  );
}
