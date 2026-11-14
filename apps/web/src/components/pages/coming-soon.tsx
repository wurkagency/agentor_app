import { Card, EmptyState } from '@agentor/ui';
import { Hammer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** Placeholder for sections built in later milestones; the shell and access checks are real. */
export async function ComingSoon() {
  const t = await getTranslations('pages');
  return (
    <Card padding="none">
      <EmptyState icon={Hammer} title={t('comingTitle')}>
        {t('comingBody')}
      </EmptyState>
    </Card>
  );
}
