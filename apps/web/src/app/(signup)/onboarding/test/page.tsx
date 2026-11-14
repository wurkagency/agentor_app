import { isUuid } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { TrustPoints } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { onboardingAccounts, onboardingInvoiceMode } from '../actions';
import { trustPoints } from '@/components/signup/frame';
import { onboardingData } from '@/components/signup/onboarding-data';
import { OnboardingDiagram } from '@/components/signup/onboarding-diagram';
import { OnboardingSteps, SkipLink } from '@/components/signup/onboarding-frame';
import { TestStep } from '@/components/signup/test-step';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.test');
  return { title: t('title') };
}

/** OB4 / MO4: test run with the 10 latest orders, nothing written, then "Gå live som kladde". */
export default async function OnboardingTestPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { session, tenant } = await requireSignupStep('test');
  const { run } = await searchParams;
  const d = await onboardingData({ tenantId: tenant!.tenantId, userId: session!.user.id });
  const [accounts, mode] = await Promise.all([onboardingAccounts(), onboardingInvoiceMode()]);
  const props = {
    initialRun: run && isUuid(run) ? run : null,
    erpName: d.diagram.erp?.name ?? '',
    invoiceMode: mode,
    accounts: accounts.ok ? (accounts.data ?? []) : [],
  };
  return (
    <Responsive
      desktop={
        <TestStep
          {...props}
          topRight={<SkipLink step="test" />}
          step={<OnboardingSteps step="test" />}
          diagram={<OnboardingDiagram data={d} />}
          points={<TrustPoints points={await trustPoints()} />}
        />
      }
      mobile={
        <TestStep
          {...props}
          mobile
          topRight={<SkipLink step="test" mobile />}
          step={<OnboardingSteps step="test" mobile />}
        />
      }
    />
  );
}
