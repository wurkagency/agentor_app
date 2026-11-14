import { getSignupCompany } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { TrustPoints } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { allSystems, logos, SU3_FEATURED } from '@/components/signup/catalogue';
import { CompanyStep, type CompanyInitial } from '@/components/signup/company-step';
import { LoginLink, SignupSteps, trustPoints } from '@/components/signup/frame';
import { db } from '@/server/infra';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.company');
  return { title: t('title') };
}

/** SU3 / MS3: CVR, systems and order volume. Coming back from SU4/SU5 edits the same company. */
export default async function SignupCompanyPage() {
  const { session, tenant } = await requireSignupStep('company');
  const saved =
    tenant && tenant.signupState !== 'active'
      ? await getSignupCompany(db(), { tenantId: tenant.tenantId, userId: session!.user.id })
      : null;
  const initial: CompanyInitial = {
    cvr: saved?.cvr ?? '',
    name: saved?.name ?? '',
    addressLine: saved?.addressLine ?? '',
    postalCode: saved?.postalCode ?? '',
    city: saved?.city ?? '',
    ordersPerMonth: saved?.ordersPerMonth ?? null,
    chosenConnectors: saved?.chosenConnectors ?? [],
  };
  const featured = logos(SU3_FEATURED);
  const all = allSystems();
  return (
    <Responsive
      desktop={
        <CompanyStep
          initial={initial}
          featured={featured}
          all={all}
          topRight={<LoginLink />}
          step={<SignupSteps current={2} />}
          points={<TrustPoints points={await trustPoints()} />}
        />
      }
      mobile={
        <CompanyStep
          mobile
          initial={initial}
          featured={featured}
          all={all}
          topRight={<LoginLink />}
          step={<SignupSteps current={2} mobile />}
          points={null}
        />
      }
    />
  );
}
