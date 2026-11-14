import { Icon } from '@agentor/ui';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { signInMethods } from '@agentor/db';
import { FocusCard } from '@/components/focus-card';
import { isRecentSignIn } from '@/server/auth/reauth';
import { requireUser } from '@/server/auth/session';
import { SSO_PROVIDERS } from '@/server/mock-sso';
import { db } from '@/server/infra';
import { SetupFlow } from './setup-flow';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('setupTitle') };
}

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const s = await requireUser();
  if (s.user.twoFactorEnabled) redirect('/');
  const t = await getTranslations('auth');
  // Without a password, a recent sign-in at Google or Microsoft stands in for it (reauth.ts).
  const methods = await signInMethods(db(), s.user.id);
  const provider = SSO_PROVIDERS.find((p) => methods.providers.includes(p)) ?? null;
  const confirm = methods.password
    ? ('password' as const)
    : isRecentSignIn(s.createdAt)
      ? ('recent' as const)
      : ('reauth' as const);
  const ssoFailed = (await searchParams).sso === 'failed';
  return (
    <FocusCard
      title={t('setupTitle')}
      intro={t('setupIntro')}
      icon={<Icon icon={ShieldCheck} size={24} />}
    >
      <SetupFlow confirm={confirm} provider={provider} ssoFailed={ssoFailed} />
    </FocusCard>
  );
}
