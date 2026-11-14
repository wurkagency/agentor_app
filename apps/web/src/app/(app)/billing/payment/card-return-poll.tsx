'use client';

import { Banner } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Back from QuickPay's card form: the new card arrives by callback (ingest → worker), so
 * refresh a few times, then drop the query string.
 */
export function CardReturnPoll() {
  const t = useTranslations('billing');
  const router = useRouter();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= 6) {
      router.replace('/billing/payment');
      return;
    }
    const id = setTimeout(() => {
      setN((x) => x + 1);
      router.refresh();
    }, 1500);
    return () => clearTimeout(id);
  }, [n, router]);
  return <Banner tone="info">{t('cardUpdating')}</Banner>;
}
