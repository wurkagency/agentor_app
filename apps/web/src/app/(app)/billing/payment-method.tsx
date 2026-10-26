'use client';

import { Button, Card, CardHeader, cn, Icon, toast } from '@agentor/ui';
import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { changeCard } from './actions';

/** Betalingsmetode (D13). The card form itself is QuickPay's; we never see card numbers. */
export function PaymentMethod({
  card,
  className,
}: {
  card: { brand: string; last4: string; expiry: string | null } | null;
  className?: string;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const [pending, start] = useTransition();

  const onChange = () =>
    start(async () => {
      const res = await changeCard();
      if (res.ok && res.data) window.location.assign(res.data.url);
      else toast.error({ title: t('cardFailed'), closeLabel: tc('close') });
    });

  return (
    <Card className={cn('flex flex-col gap-4', className)}>
      <CardHeader title={t('paymentMethod')} />
      <div className="flex items-start gap-3">
        <Icon icon={CreditCard} size={18} className="mt-0.5 text-fg-2" />
        <div className="flex flex-col">
          <span className="text-table font-semibold">
            {card ? `${card.brand} •••• ${card.last4}` : t('noCard')}
          </span>
          <span className="text-meta text-fg-2">
            {card?.expiry ? t('cardExpiry', { expiry: card.expiry }) : t('viaQuickPay')}
          </span>
        </div>
      </div>
      <div>
        <Button variant="secondary" size="s" onClick={onChange} loading={pending}>
          {card ? t('changeCard') : t('addCard')}
        </Button>
      </div>
    </Card>
  );
}
