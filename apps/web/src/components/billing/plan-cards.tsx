'use client';

import { formatNumber } from '@agentor/i18n';
import { cn, Icon } from '@agentor/ui';
import { Check, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface PlanCardData {
  id: string;
  name: string;
  priceOre: number;
  pollingMinutes: number;
  transactions: number | null;
  destinations: number | null;
  features: string[];
  excluded?: string[];
}

/** The plan's selling points as short lines (D13 / D14-Onboarding-2). */
export function usePlanLines() {
  const t = useTranslations('plans');
  const locale = useLocale() as 'da' | 'en';
  return (p: PlanCardData) => {
    const lines: string[] = [
      p.pollingMinutes === 1
        ? t('pollingEveryMinute')
        : t('pollingEvery', { minutes: p.pollingMinutes }),
    ];
    if (p.transactions !== null)
      lines.push(t('transactions', { count: formatNumber(p.transactions, locale) }));
    lines.push(
      p.destinations === null
        ? t('features.moreDestinations')
        : t('destinations', { count: p.destinations }),
    );
    for (const f of p.features) {
      if (['transactions', 'polling', 'destinations3', 'moreDestinations'].includes(f)) continue;
      lines.push(t(`features.${f}`));
    }
    return lines;
  };
}

export function PlanPrice({ priceOre, suffix }: { priceOre: number; suffix: string }) {
  const locale = useLocale() as 'da' | 'en';
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-stat font-semibold tracking-snug tabular">
        {formatNumber(Math.round(priceOre / 100), locale)}
      </span>
      <span className="text-meta text-fg-2">{suffix}</span>
    </span>
  );
}

/** Feature line with a check or a struck-through dash (D13 "Sammenlign planer"). */
export function FeatureLine({ included, children }: { included: boolean; children: ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2', !included && 'text-fg-2 line-through')}>
      <Icon
        icon={included ? Check : Minus}
        size={14}
        className={cn('mt-0.5 flex-none', included ? 'text-ok-fg' : 'text-fg-2')}
      />
      <span>{children}</span>
    </li>
  );
}
