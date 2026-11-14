import { getTranslations } from 'next-intl/server';
import { NewCaseForm } from '@/components/support/support-forms';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireCustomerArea } from '@/server/auth/session';
import { viewsFor } from '@/server/flows';

export async function generateMetadata() {
  const t = await getTranslations('support');
  return { title: t('new') };
}

export default async function NewSupportCasePage() {
  const ctx = await requireCustomerArea();
  const t = await getTranslations('support');
  const flows = await viewsFor(ctx);
  return (
    <PageBody>
      <PageHeader title={t('new')} subtitle={t('newIntro')} />
      <NewCaseForm flows={flows.map((f) => ({ id: f.id, name: f.name }))} />
    </PageBody>
  );
}
