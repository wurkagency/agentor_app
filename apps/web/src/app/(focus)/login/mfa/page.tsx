import { Icon } from '@agentor/ui';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { FocusCard } from '@/components/focus-card';
import { MfaForm } from './mfa-form';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('mfaTitle') };
}

export default async function MfaPage() {
  const t = await getTranslations('auth');
  return (
    <FocusCard
      title={t('mfaTitle')}
      intro={t('mfaIntro')}
      icon={<Icon icon={ShieldCheck} size={24} />}
    >
      <MfaForm />
    </FocusCard>
  );
}
