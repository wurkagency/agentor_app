import { Banner, Icon } from '@agentor/ui';
import { CirclePause } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { FocusCard } from '@/components/focus-card';
import { LogoutButton } from '../invite/[token]/invite-forms';

export async function generateMetadata() {
  const t = await getTranslations('suspended');
  return { title: t('title') };
}

/**
 * The company has been suspended by Agentor (Platform › Kunde): the app doesn't open for anyone in
 * it until Agentor reactivates the company. No company data is shown here.
 */
export default async function SuspendedPage() {
  const t = await getTranslations('suspended');
  return (
    <FocusCard title={t('title')} icon={<Icon icon={CirclePause} size={24} />}>
      <Banner tone="warn">{t('body')}</Banner>
      <LogoutButton />
    </FocusCard>
  );
}
