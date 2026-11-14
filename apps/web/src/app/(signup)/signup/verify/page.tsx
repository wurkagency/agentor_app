import { Responsive } from '@agentor/ui/mobile';
import {
  MobileSignupShell,
  NavyCard,
  SignupShell,
  StepPlan,
  TrustPanel,
  TrustPoints,
} from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { LoginLink, SignupSteps, trustPoints } from '@/components/signup/frame';
import { VerifyForm } from '@/components/signup/verify-form';
import { requireSignupStep, resendWait } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.verify');
  return { title: t('title') };
}

/** SU2 / MS2: confirm the e-mail with the 6-digit code. Google and Microsoft skip this step. */
export default async function SignupVerifyPage() {
  const { pending } = await requireSignupStep('verify');
  if (!pending) redirect('/signup');
  const t = await getTranslations('signupFlow.verify');
  const wait = resendWait(pending);
  const plan = (short: boolean) => [
    { title: t('plan1'), text: t('plan1Text') },
    { title: t('plan2'), text: short ? t('plan2TextShort') : t('plan2Text') },
    { title: t('plan3'), text: short ? t('plan3TextShort') : t('plan3Text') },
    { title: t('plan4'), text: short ? t('plan4TextShort') : t('plan4Text') },
  ];
  return (
    <Responsive
      desktop={
        <SignupShell
          topRight={<LoginLink />}
          step={<SignupSteps current={1} />}
          panel={
            <TrustPanel
              label={t('panelTitle')}
              title={t('panelTitle')}
              lead={t('panelLead')}
              points={<TrustPoints points={await trustPoints()} />}
            >
              <StepPlan items={plan(false)} />
            </TrustPanel>
          }
        >
          <VerifyForm email={pending.email} waitSeconds={wait} />
        </SignupShell>
      }
      mobile={
        <MobileSignupShell
          topRight={<LoginLink />}
          step={<SignupSteps current={1} mobile />}
          footer={
            <NavyCard title={t('panelTitle')}>
              <StepPlan items={plan(true)} mobile />
            </NavyCard>
          }
        >
          <VerifyForm mobile email={pending.email} waitSeconds={wait} />
        </MobileSignupShell>
      }
    />
  );
}
