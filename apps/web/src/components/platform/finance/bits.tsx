import { formatMoney, formatNumber, type Locale } from '@agentor/i18n';
import { CardHeader, cn, type Growth } from '@agentor/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { initials } from '@/server/platform-data';

/** Whole kroner for key figures ("25.894"), with "kr." shown as the unit. */
export const kr = (ore: number, locale: Locale) => formatNumber(Math.round(ore / 100), locale);
/** Amounts in tables, with øre ("3.600,00 kr."). */
export const money = (ore: number, locale: Locale) => formatMoney(ore / 100, locale);

/** A growth badge from a percent change; `goodWhenUp` decides the colour. */
export function growthOf(
  change: number | null,
  text: (abs: string) => string,
  locale: Locale,
  goodWhenUp = true,
): Growth | undefined {
  if (change === null || !Number.isFinite(change)) return undefined;
  const abs = formatNumber(Math.abs(change), locale, Math.abs(change) < 10 ? 1 : 0);
  const direction = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';
  const tone =
    direction === 'flat' ? 'neutral' : (direction === 'up') === goodWhenUp ? 'good' : 'bad';
  return { direction, tone, text: text(abs) };
}

export function CustomerChip({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="grid size-7 flex-none place-items-center rounded-xs bg-bg-base text-nano font-semibold shadow-ring-chip">
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Filter chips as links (F2, F6): the active one is lime. */
export function FilterChips({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? 'true' : undefined}
          className={cn(
            'inline-flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-table font-medium text-fg-1 no-underline',
            i.active ? 'bg-primary font-semibold' : 'bg-surface shadow-ring-chip hover:bg-bg-base',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Two-way toggle as links (Dage | Måneder, September | Oktober): the active one is dark. */
export function ToggleLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full bg-surface p-1 shadow-sm"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? 'true' : undefined}
          className={cn(
            'inline-flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-table font-medium no-underline',
            i.active ? 'bg-fg-1 font-semibold text-white' : 'text-fg-2 hover:text-fg-1',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function withParams(base: string, params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

const BCP = { da: 'da-DK', en: 'en-GB' } as const;
const fmt = (locale: Locale, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(BCP[locale], { timeZone: 'Europe/Copenhagen', ...o });

/** "31. okt." */
export const dayMonth = (d: Date, locale: Locale) =>
  fmt(locale, { day: 'numeric', month: 'short' }).format(d);
/** "Oktober 2026" */
export const monthYear = (d: Date, locale: Locale) => {
  const s = fmt(locale, { month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** "okt." */
export const monthShort = (d: Date, locale: Locale) => fmt(locale, { month: 'short' }).format(d);
/** "oktober" */
export const monthLong = (d: Date, locale: Locale) => fmt(locale, { month: 'long' }).format(d);

/** Card header inside a padding-less card (tables run edge to edge). */
export function PanelHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 pb-3 pt-5">
      <CardHeader title={title} {...(action ? { action } : {})} />
    </div>
  );
}
