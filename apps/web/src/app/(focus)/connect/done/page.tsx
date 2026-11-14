import { Icon } from '@agentor/ui';
import { CircleCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { FocusCard } from '@/components/focus-card';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.connect');
  return { title: t('doneTitle') };
}

/**
 * After connecting in the phone's system browser (PLAN-SIGNUP B11): this browser has no app
 * session, so it only says to go back; the app sees the new connection on its own.
 */
export default async function ConnectDonePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; error?: string }>;
}) {
  const { name, error } = await searchParams;
  const t = await getTranslations('onboardingFlow.connect');
  return (
    <FocusCard
      icon={<Icon icon={CircleCheck} size={24} />}
      title={error ? t('doneErrorTitle') : t('doneTitle')}
      intro={error ? t('doneErrorText') : t('doneText', { name: (name ?? '').slice(0, 60) })}
    >
      <a href="/onboarding/webshop" className="text-table font-semibold text-fg-1">
        {t('backToApp')}
      </a>
    </FocusCard>
  );
}
