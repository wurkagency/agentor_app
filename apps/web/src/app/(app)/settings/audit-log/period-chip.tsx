'use client';

import { cn, Icon } from '@agentor/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

/**
 * "Sidste 30 dage" (MA32) as a chip over a native select: the phone's own picker, labelled, and
 * the period stays in the URL like the desktop filter.
 */
export function PeriodChip({ query }: { query: Record<string, string> }) {
  const t = useTranslations('audit');
  const router = useRouter();
  const pathname = usePathname();
  const value = query.period ?? '30';
  return (
    <span
      className={cn(
        'relative inline-flex h-8 flex-none items-center gap-1 rounded-full bg-white whitespace-nowrap pl-3.5 pr-2.5 text-table font-medium text-fg-1 shadow-ring-chip',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg-1',
      )}
    >
      {t(`last${value}` as 'last30')}
      <Icon icon={ChevronDown} size={14} />
      <select
        aria-label={t('period')}
        value={value}
        onChange={(e) => {
          const p = new URLSearchParams(query);
          p.delete('before');
          if (e.target.value === '30') p.delete('period');
          else p.set('period', e.target.value);
          router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
        }}
        className="touch-target absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        <option value="7">{t('last7')}</option>
        <option value="30">{t('last30')}</option>
        <option value="90">{t('last90')}</option>
      </select>
    </span>
  );
}
