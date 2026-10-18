import { getTranslations } from 'next-intl/server';
import { FocusCard } from '@/components/focus-card';
import { ForgotForm } from './forgot-form';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('forgotTitle') };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <FocusCard title={t('forgotTitle')} intro={t('forgotIntro')}>
      <ForgotForm />
    </FocusCard>
  );
}
