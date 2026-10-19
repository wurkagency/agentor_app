import { listOwnTenants } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/server/auth/session';
import { db } from '@/server/infra';
import { CompanyStep } from './company-step';
import { OnboardingCard } from './stepper';

export async function generateMetadata() {
  const t = await getTranslations('onboarding');
  return { title: t('companyTitle') };
}

/**
 * Onboarding step 1 (D14-Onboarding-1). A user who already owns a company that hasn't finished
 * onboarding continues where they left off; otherwise this creates a (further) company.
 */
export default async function OnboardingCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const s = await requireUser();
  const { new: fresh } = await searchParams;
  if (fresh !== '1') {
    const own = await listOwnTenants(db(), s.user.id);
    if (own.some((t) => t.role === 'owner')) redirect('/onboarding/plan');
    if (own.length > 0) redirect('/');
  }
  const t = await getTranslations('onboarding');
  return (
    <OnboardingCard step={1} narrow title={t('companyTitle')} intro={t('companyIntro')}>
      <CompanyStep locale={s.user.locale} />
    </OnboardingCard>
  );
}
