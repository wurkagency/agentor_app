import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { MyTimeMobile } from './mobile';
import { TimeView } from './view';

export async function generateMetadata() {
  const t = await getTranslations('platform.time');
  return { title: t('title') };
}

export default async function MyTimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  return (
    <Responsive
      desktop={<TimeView team={false} week={week} />}
      mobile={<MyTimeMobile week={week} />}
    />
  );
}
