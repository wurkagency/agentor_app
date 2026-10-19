import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/server/auth/session';
import { OnboardingCard } from '../stepper';
import { TemplateStep } from './template-step';

export async function generateMetadata() {
  const t = await getTranslations('onboarding');
  return { title: t('flowTitle') };
}

/** Onboarding step 3 (D14-Onboarding-3): choose a first template or skip. */
export default async function OnboardingFlowPage() {
  const ctx = await requireRole(['owner']);
  if (ctx.tenant.onboardingCompleted) redirect('/');
  const t = await getTranslations('onboarding');
  return (
    <OnboardingCard step={3} title={t('flowTitle')} intro={t('flowIntro')}>
      <TemplateStep />
    </OnboardingCard>
  );
}
