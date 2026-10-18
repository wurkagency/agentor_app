import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/pages/coming-soon';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('billing') };
}

export default async function Page() {
  const t = await getTranslations('pages');
  return (
    <PageBody>
      <PageHeader title={t('billing')} />
      <ComingSoon />
    </PageBody>
  );
}
