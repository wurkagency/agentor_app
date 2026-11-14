'use client';

import type { QuotaState } from '@agentor/core';
import { formatDate, formatPercent } from '@agentor/i18n';
import { Banner, Button, toast } from '@agentor/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { buyAddon } from './actions';

/**
 * Quota warnings (D2): 80 % warns, 100 % runs on for the grace period with notice, after that
 * Live writes need extra transactions. Never silent.
 */
export function QuotaNotice({ quota }: { quota: QuotaState }) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const [pending, start] = useTransition();
  if (quota.level === 'ok') return null;

  const buy = () =>
    start(async () => {
      const res = await buyAddon(1);
      if (res.ok) {
        toast.ok({ title: t('addonBought'), closeLabel: tc('close') });
        router.refresh();
      } else toast.error({ title: t('addonFailed'), closeLabel: tc('close') });
    });

  const action = (
    <Button variant="dark" size="s" onClick={buy} loading={pending}>
      {t('buyAddon')}
    </Button>
  );
  if (quota.level === 'warn')
    return (
      <Banner tone="warn">{t('quotaWarn', { pct: formatPercent(quota.ratio, locale, 0) })}</Banner>
    );
  if (quota.level === 'over')
    return (
      <Banner tone="warn" action={action}>
        {t('quotaOver', {
          date: quota.graceEndsAt ? formatDate(new Date(quota.graceEndsAt), locale) : '',
        })}
      </Banner>
    );
  return (
    <Banner tone="error" action={action}>
      {t('quotaNeedsAddon')}
    </Banner>
  );
}
