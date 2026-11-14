import { formatMoney } from '@agentor/i18n';
import { Banner } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FocusCard } from '@/components/focus-card';
import { requireUser } from '@/server/auth/session';
import { env } from '@/server/env';
import { sameOriginPath } from '@/server/same-origin';
import { MockCheckoutForm } from './mock-form';

export async function generateMetadata() {
  const t = await getTranslations('checkout');
  return { title: t('title') };
}

/**
 * Stand-in for QuickPay's card form when QUICKPAY_MODE=mock (local development and e2e). It
 * exercises the real callback path: signed callback → agentor-ingest → queue → worker.
 * Doesn't exist in test or live mode.
 */
export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (env().QUICKPAY_MODE !== 'mock') notFound();
  const s = await requireUser();
  const p = await searchParams;
  const amount = Number(p.amount ?? 0);
  const t = await getTranslations('checkout');
  return (
    <FocusCard
      title={t('title')}
      intro={t('intro', { amount: formatMoney(amount / 100, s.user.locale) })}
    >
      <Banner tone="info">{t('mockNotice')}</Banner>
      <MockCheckoutForm
        subscription={p.subscription ?? ''}
        order={p.order ?? ''}
        continueUrl={sameOriginPath(p.continue ?? '/')}
        cancelUrl={sameOriginPath(p.cancel ?? '/')}
      />
    </FocusCard>
  );
}
