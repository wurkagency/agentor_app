import { Responsive } from '@agentor/ui/mobile';
import { TrustPoints } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { trustPoints } from '@/components/signup/frame';
import { ConnectStep } from '@/components/signup/connect-step';
import { onboardingData, optionsFor } from '@/components/signup/onboarding-data';
import { OnboardingSteps, SkipLink } from '@/components/signup/onboarding-frame';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.webshop');
  return { title: t('title') };
}

/** OB1 / MO1: connect the webshop chosen on SU3 (read access only). */
export default async function OnboardingWebshopPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; connectError?: string }>;
}) {
  const { session, tenant } = await requireSignupStep('webshop');
  const sp = await searchParams;
  const d = await onboardingData({ tenantId: tenant!.tenantId, userId: session!.user.id });
  const options = optionsFor('webshop', d.chosen);
  const chosenId = options.find((o) => d.chosen.includes(o.id))?.id ?? null;
  const common = {
    step: 'webshop' as const,
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
          topRight={<SkipLink step="webshop" />}
          step_={<OnboardingSteps step="webshop" />}
          points={<TrustPoints points={await trustPoints()} />}
        />
      }
      mobile={
        <ConnectStep
          {...common}
          mobile
          topRight={<SkipLink step="webshop" mobile />}
          step_={<OnboardingSteps step="webshop" mobile />}
        />
      }
    />
  );
}
