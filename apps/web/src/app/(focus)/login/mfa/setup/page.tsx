import { Icon } from '@agentor/ui';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { FocusCard } from '@/components/focus-card';
import { requireUser } from '@/server/auth/session';
import { SetupFlow } from './setup-flow';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('setupTitle') };
}

export default async function MfaSetupPage() {
  const s = await requireUser();
  if (s.user.twoFactorEnabled) redirect('/');
  const t = await getTranslations('auth');
  return (
    <FocusCard
      title={t('setupTitle')}
      intro={t('setupIntro')}
      icon={<Icon icon={ShieldCheck} size={24} />}
    >
      <SetupFlow />
    </FocusCard>
  );
}
