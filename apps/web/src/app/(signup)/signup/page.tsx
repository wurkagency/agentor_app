import { Responsive } from '@agentor/ui/mobile';
import {
  MobileSignupShell,
  SignupShell,
  TrustExamples,
  TrustLogoWall,
  TrustPanel,
  TrustPoints,
} from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { AccountForm } from '@/components/signup/account-form';
import {
  CATALOGUE_SIZE,
  catalogueEntry,
  logos,
  MS1_LOGO_ROW,
  SU1_LOGO_WALL,
} from '@/components/signup/catalogue';
import { LoginLink, SignupSteps, trustPoints } from '@/components/signup/frame';
import { env } from '@/server/env';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.account');
  return { title: t('title') };
}

/** SU1 / MS1: create the account with Google, Microsoft or e-mail (README decision 21). */
export default async function SignupAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  await requireSignupStep('account');
  const t = await getTranslations('signupFlow.account');
  const ssoEnabled = env().SSO_MODE !== 'off';
  const ssoError = (await searchParams).sso === 'failed' ? t('errors.ssoFailed') : undefined;
  const example = (id: string) => {
    const c = catalogueEntry(id);
    return { name: c?.name ?? id, logoUrl: c?.logo ?? undefined };
  };
  const row = logos(MS1_LOGO_ROW);
  return (
    <Responsive
      desktop={
        <SignupShell
          topRight={<LoginLink />}
          step={<SignupSteps current={1} showNext={false} />}
          panel={
            <TrustPanel
              label={t('panelTitle')}
              title={t('panelTitle')}
              lead={t('panelLead')}
              points={<TrustPoints points={await trustPoints()} />}
            >
              <TrustLogoWall logos={logos(SU1_LOGO_WALL)} />
              <TrustExamples
                label={t('examples')}
                items={[
                  { logo: example('woocommerce'), title: t('example1'), meta: t('example1Meta') },
                  { logo: example('woocommerce'), title: t('example2'), meta: t('example2Meta') },
                  { logo: example('shopify'), title: t('example3'), meta: t('example3Meta') },
                ]}
              />
            </TrustPanel>
          }
        >
          <AccountForm ssoEnabled={ssoEnabled} initialError={ssoError} />
        </SignupShell>
      }
      mobile={
        <MobileSignupShell
          topRight={<LoginLink />}
          step={<SignupSteps current={1} mobile showNext={false} />}
        >
          <AccountForm
            mobile
            ssoEnabled={ssoEnabled}
            initialError={ssoError}
            logoRow={row}
            more={t('more', { count: CATALOGUE_SIZE - row.length })}
            points={await trustPoints(true)}
          />
        </MobileSignupShell>
      }
    />
  );
}
