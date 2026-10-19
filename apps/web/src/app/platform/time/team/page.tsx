import { getTranslations } from 'next-intl/server';
import { TimeView } from '../view';

export async function generateMetadata() {
  const t = await getTranslations('platform.time');
  return { title: t('teamTitle') };
}

export default async function TeamTimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  return <TimeView team week={(await searchParams).week} />;
}
