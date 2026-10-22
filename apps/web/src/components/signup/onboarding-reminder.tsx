import { Icon } from '@agentor/ui';
import { ArrowRight, ListChecks } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { resumeOnboardingAction } from '@/app/(signup)/onboarding/actions';
import type { AppContext } from '@/server/auth/session';

/**
 * Overblik after "Spring over" (README decision 21): a reminder until onboarding is done, which
 * takes the owner back to where it stopped. Desktop and mobile.
 */
export async function OnboardingReminder({ ctx }: { ctx: AppContext }) {
  const m = ctx.tenant;
  if (
    ctx.support ||
    m.role !== 'owner' ||
    !m.onboardingSkipped ||
    !m.onboardingStep ||
    m.onboardingStep === 'done'
  )
    return null;
  const t = await getTranslations('onboardingFlow');
  const step = m.onboardingStep;
  return (
    <section
      aria-label={t('reminder.title')}
      className="mx-auto mt-4 flex w-full max-w-content flex-wrap items-center gap-4 px-gutter"
    >
      <div className="flex w-full flex-wrap items-center gap-4 rounded-md bg-navy px-5 py-4 text-on-navy">
        <span className="grid size-10 flex-none place-items-center rounded-node bg-primary text-fg-1">
          <Icon icon={ListChecks} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <strong className="text-card">{t('reminder.title')}</strong>
          <span className="text-table text-on-navy-muted">
            {t('reminder.text', { step: t(`steps.${step}`) })}
          </span>
        </span>
        <form action={resumeOnboardingAction}>
          <button
            type="submit"
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-0 bg-primary px-5 font-sans text-table font-semibold text-fg-1"
          >
            {t('reminder.resume')}
            <Icon icon={ArrowRight} size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
