import { getTranslations } from 'next-intl/server';
import { CustomersView } from '../view';

export async function generateMetadata() {
  const t = await getTranslations('platform.customers');
  return { title: t('mine') };
}

export default async function MyCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  return <CustomersView view="mine" query={sp.q ?? ''} expired={false} />;
}
