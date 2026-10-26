import { Responsive } from '@agentor/ui/mobile';
import { TrustPoints } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { trustPoints } from '@/components/signup/frame';
import { ConnectStep } from '@/components/signup/connect-step';
import { onboardingData, optionsFor } from '@/components/signup/onboarding-data';
import { OnboardingSteps, SkipLink } from '@/components/signup/onboarding-frame';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.accounting');
  return { title: t('title') };
}

/** OB2 / MO2: connect the accounting system chosen on SU3, with its list of permissions. */
export default async function OnboardingAccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; connectError?: string }>;
}) {
  const { session, tenant } = await requireSignupStep('accounting');
  const sp = await searchParams;
  const d = await onboardingData({ tenantId: tenant!.tenantId, userId: session!.user.id });
  const options = optionsFor('erp', d.chosen);
  const chosenId = options.find((o) => d.chosen.includes(o.id))?.id ?? null;
  const common = {
    step: 'accounting' as const,
    options,
    chosenId,
    diagram: d.diagram,
    initialConnections: d.connections,
    justConnected: !!sp.connected,
    connectError: sp.connectError?.replace(/[^a-zA-Z]/g, '').slice(0, 30),
    companyName: d.state?.companyName ?? '',
    featured: 4,
  };
  return (
    <Responsive
      desktop={
        <ConnectStep
          {...common}
          topRight={<SkipLink step="accounting" />}
          step_={<OnboardingSteps step="accounting" />}
          points={<TrustPoints points={await trustPoints()} />}
        />
      }
      mobile={
        <ConnectStep
          {...common}
          mobile
          topRight={<SkipLink step="accounting" mobile />}
          step_={<OnboardingSteps step="accounting" mobile />}
        />
      }
    />
  );
}
