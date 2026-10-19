import { getTranslations } from 'next-intl/server';
import { TimeView } from './view';

export async function generateMetadata() {
  const t = await getTranslations('platform.time');
  return { title: t('title') };
}

export default async function MyTimePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <TimeView team={false} week={(await searchParams).week} />;
}
