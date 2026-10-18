import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/pages/coming-soon';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';

export async function generateMetadata() {
  const t = await getTranslations('nav');
  return { title: t('security') };
}

export default async function Page() {
  await requireRole(['owner', 'admin']);
  const t = await getTranslations('nav');
  return (
    <PageBody>
      <PageHeader eyebrow={t('settings')} title={t('security')} />
      <ComingSoon />
    </PageBody>
  );
}
