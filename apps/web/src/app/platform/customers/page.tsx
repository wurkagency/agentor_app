import { getTranslations } from 'next-intl/server';
import { CustomersView } from './view';

export async function generateMetadata() {
  const t = await getTranslations('platform.customers');
  return { title: t('title') };
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; expired?: string; filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === 'attention' || sp.filter === 'mine' ? sp.filter : 'all';
  return <CustomersView query={sp.q ?? ''} expired={sp.expired === '1'} filter={filter} />;
}
