import { getBillingOverview } from '@agentor/db';
import { Banner } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { brandName } from '@/components/billing/card';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { PaymentMethod } from '../payment-method';
import { CardReturnPoll } from './card-return-poll';

export async function generateMetadata() {
  const t = await getTranslations('billing');
  return { title: t('paymentMethod') };
}

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const ctx = await requireRole(['owner']);
  const o = await getBillingOverview(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  if (!o) notFound();
  const { card } = await searchParams;
  const t = await getTranslations('billing');
  const s = o.subscription;
  return (
    <PageBody>
      <PageHeader eyebrow={t('title')} title={t('paymentMethod')} subtitle={t('paymentIntro')} />
      {card === 'return' && <CardReturnPoll />}
      {s.status === 'past_due' && <Banner tone="error">{t('pastDueShort')}</Banner>}
      <PaymentMethod
        className="max-w-form"
        card={
          s.cardLast4
            ? { brand: brandName(s.cardBrand), last4: s.cardLast4, expiry: s.cardExpiry }
            : null
        }
      />
    </PageBody>
  );
}
