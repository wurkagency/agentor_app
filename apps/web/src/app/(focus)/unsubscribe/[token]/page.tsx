import { unsubscribeInfo } from '@agentor/db';
import { Button } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FocusCard } from '@/components/focus-card';
import { db } from '@/server/infra';
import { unsubscribeAction } from './actions';

export async function generateMetadata() {
  const t = await getTranslations('unsubscribe');
  return { title: t('title') };
}

/**
 * The weekly summary's unsubscribe link (E22): no login, the token in the link is the proof. The
 * page only asks; the button turns the e-mail off (mail clients also POST one-click to
 * /api/unsubscribe/<token>, RFC 8058).
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, { done }, t] = await Promise.all([
    params,
    searchParams,
    getTranslations('unsubscribe'),
  ]);
  const info = await unsubscribeInfo(db(), token);
  if (!info)
    return (
      <FocusCard title={t('title')} intro={t('invalid')}>
        <Button asChild variant="secondary">
          <Link href="/settings/notifications">{t('settings')}</Link>
        </Button>
      </FocusCard>
    );
  if (done || !info.active)
    return (
      <FocusCard
        title={t('title')}
        intro={done ? t('done', { company: info.tenantName }) : t('already')}
      >
        <Button asChild variant="secondary">
          <Link href="/settings/notifications">{t('settings')}</Link>
        </Button>
      </FocusCard>
    );
  return (
    <FocusCard title={t('title')} intro={t('intro', { company: info.tenantName })}>
      <form action={unsubscribeAction.bind(null, token)}>
        <Button type="submit">{t('button')}</Button>
      </form>
    </FocusCard>
  );
}
