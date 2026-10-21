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
  // MP01 opens on "Kræver opmærksomhed"; ?filter=all shows every customer.
  const filter = sp.filter === 'all' ? 'all' : 'attention';
  return <CustomersView query={sp.q ?? ''} expired={sp.expired === '1'} filter={filter} />;
}
