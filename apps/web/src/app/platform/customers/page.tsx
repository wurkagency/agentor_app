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
  // Every customer by default; ?filter=attention narrows to those that need attention.
  const filter = sp.filter === 'attention' ? 'attention' : 'all';
  return <CustomersView query={sp.q ?? ''} expired={sp.expired === '1'} filter={filter} />;
}
