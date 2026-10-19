import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { FocusCard } from '@/components/focus-card';
import { getUserSession } from '@/server/auth/session';
import { SignupForm } from './signup-form';

export async function generateMetadata() {
  const t = await getTranslations('signup');
  return { title: t('title') };
}

export default async function SignupPage() {
  if (await getUserSession()) redirect('/');
  const t = await getTranslations('signup');
  return (
    <FocusCard title={t('title')} intro={t('intro')}>
      <SignupForm />
    </FocusCard>
  );
}
