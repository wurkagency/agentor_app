'use client';

import { Segmented } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type Period = 'today' | '7d' | '30d';

/** I dag / 7 dage / 30 dage (D1). Kept in the URL so the view can be shared (§5.2). */
export function PeriodSelector() {
  const t = useTranslations('period');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = (params.get('period') as Period | null) ?? '7d';
  return (
    <Segmented
      aria-label={t('label')}
      tone="dark"
      value={value}
      onValueChange={(v) => {
        const next = new URLSearchParams(params);
        if (v === '7d') next.delete('period');
        else next.set('period', v);
        router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
      }}
      options={[
        { value: 'today', label: t('today') },
        { value: '7d', label: t('7d') },
        { value: '30d', label: t('30d') },
      ]}
    />
  );
}
