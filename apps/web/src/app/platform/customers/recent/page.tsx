import { getTranslations } from 'next-intl/server';
import { CustomersView } from '../view';

export async function generateMetadata() {
  const t = await getTranslations('platform.customers');
  return { title: t('recent') };
}

export default async function RecentCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  return <CustomersView view="recent" query={sp.q ?? ''} expired={false} />;
}
