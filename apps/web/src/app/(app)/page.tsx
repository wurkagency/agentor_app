import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/pages/coming-soon';
import { PageBody, PageHeader, SecondaryBar } from '@/components/shell/secondary-nav';
import { requireAppContext } from '@/server/auth/session';
import { PeriodSelector } from './period-selector';

export async function generateMetadata() {
  const t = await getTranslations('pages');
  return { title: t('overview') };
}

function greetingKey(now: Date) {
  const h = Number(
    new Intl.DateTimeFormat('da-DK', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Europe/Copenhagen',
    }).format(now),
  );
  return h < 10 ? 'greetingMorning' : h < 18 ? 'greetingDay' : 'greetingEvening';
}

/** Overblik (D1). The secondary row is the period selector, not section navigation. */
export default async function OverviewPage() {
  const ctx = await requireAppContext();
  const t = await getTranslations('pages');
  const nav = await getTranslations('nav');
  const firstName = ctx.user.name.split(' ')[0] ?? ctx.user.name;
  return (
    <>
      <SecondaryBar label={nav('secondary')}>
        <PeriodSelector />
      </SecondaryBar>
      <PageBody>
        <PageHeader title={t(greetingKey(new Date()), { name: firstName })} />
        <ComingSoon />
      </PageBody>
    </>
  );
}
