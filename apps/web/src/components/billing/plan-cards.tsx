'use client';

import { formatNumber } from '@agentor/i18n';
import { cn, Icon } from '@agentor/ui';
import { Check, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
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

/** Selectable plan cards; the whole card is the radio (D14-Onboarding-2). */
export function PlanRadioCards({
  plans,
  value,
  onChange,
  recommended,
  recommendedLabel,
  label,
}: {
  plans: PlanCardData[];
  value: string;
  onChange: (id: string) => void;
  recommended: string | null;
  recommendedLabel: ReactNode;
  label: string;
}) {
  const t = useTranslations('plans');
  const lines = usePlanLines();
  return (
    <RadioPrimitive.Root
      value={value}
      onValueChange={onChange}
      aria-label={label}
      className="grid gap-3 md:grid-cols-3"
    >
      {plans.map((p) => (
        <RadioPrimitive.Item
          key={p.id}
          value={p.id}
          className={cn(
            'flex cursor-pointer flex-col gap-3 rounded-node border-0 bg-surface p-4 text-left shadow-ring-chip',
            'data-[state=checked]:shadow-ring-dark-2',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-body font-semibold">{p.name}</span>
            <span
              aria-hidden
              className={cn(
                'grid size-4.5 place-items-center rounded-full shadow-ring-off',
                value === p.id && 'shadow-radio-on',
              )}
            />
          </span>
          <PlanPrice priceOre={p.priceOre} suffix={t('perMonthShort')} />
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-table text-fg-1">
            {lines(p).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {recommended === p.id && (
            <span className="mt-auto text-meta text-fg-2">{recommendedLabel}</span>
          )}
        </RadioPrimitive.Item>
      ))}
    </RadioPrimitive.Root>
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
