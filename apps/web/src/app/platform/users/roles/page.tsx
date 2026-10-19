import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireStaff } from '@/server/platform';
import { RightsTable } from '../rights';

export async function generateMetadata() {
  const t = await getTranslations('platform.users');
  return { title: t('rolesTab') };
}

export default async function RolesPage() {
  await requireStaff(true);
  const t = await getTranslations('platform.users');
  return (
    <PageBody>
      <PageHeader title={t('rolesTitle')} subtitle={t('rolesIntro')} />
      <RightsTable />
    </PageBody>
  );
}
