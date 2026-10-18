import { Banner } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FocusCard } from '@/components/focus-card';
import { ResetForm } from './reset-form';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('resetTitle') };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <FocusCard title={t('resetTitle')}>
      {!token || error ? (
        <div className="flex flex-col gap-5">
          <Banner tone="error">{t('resetInvalid')}</Banner>
          <Link href="/forgot-password" className="text-table font-semibold text-fg-1">
            {t('forgotTitle')}
          </Link>
        </div>
      ) : (
        <ResetForm token={token} />
      )}
    </FocusCard>
  );
}
