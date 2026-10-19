import { getTranslations } from 'next-intl/server';
import { CustomersView } from './view';

export async function generateMetadata() {
  const t = await getTranslations('platform.customers');
  return { title: t('title') };
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  return <CustomersView view="all" query={sp.q ?? ''} expired={sp.expired === '1'} />;
}
