import { Card, NoAccessState } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';

/** "Ingen adgang" is an empty state with a lock (designspecifikation §5.4). */
export default async function Forbidden() {
  const t = await getTranslations('access');
  return (
    <main className="flex-1 px-4 pb-10 pt-6 md:px-10">
      <div className="mx-auto max-w-content">
        <Card padding="none">
          <NoAccessState title={t('title')}>{t('body')}</NoAccessState>
        </Card>
      </div>
    </main>
  );
}
