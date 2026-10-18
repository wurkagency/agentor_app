import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { FocusCard } from '@/components/focus-card';
import { getUserSession } from '@/server/auth/session';
import { safeNext } from '@/lib/safe-next';
import { LoginForm } from './login-form';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getUserSession()) redirect(next);
  const t = await getTranslations('auth');
  return (
    <FocusCard title={t('loginTitle')} intro={t('loginIntro')}>
      <LoginForm next={next} />
    </FocusCard>
  );
}
