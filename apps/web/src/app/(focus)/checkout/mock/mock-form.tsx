'use client';

import { Banner, Button, Field, LockedValue } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { submitMockCard } from './actions';

export function MockCheckoutForm({
  subscription,
  order,
  continueUrl,
  cancelUrl,
}: {
  subscription: string;
  order: string;
  continueUrl: string;
  cancelUrl: string;
}) {
  const t = useTranslations('checkout');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (outcome: 'accept' | 'decline') =>
    start(async () => {
      setError(null);
      const res = await submitMockCard({ subscription, order, continueUrl, cancelUrl, outcome });
      if (res && !res.ok) setError(res.error);
    });

  return (
    <div className="flex flex-col gap-5">
      {error && <Banner tone="error">{t('error')}</Banner>}
      <Field label={t('card')}>{() => <LockedValue>Visa •••• 4242 · 08/28</LockedValue>}</Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="m" asChild>
          <a href={cancelUrl}>{t('cancel')}</a>
        </Button>
        <Button variant="secondary" size="m" onClick={() => submit('decline')} disabled={pending}>
          {t('decline')}
        </Button>
        <Button variant="primary" size="m" onClick={() => submit('accept')} loading={pending}>
          {t('approve')}
        </Button>
      </div>
    </div>
  );
}
