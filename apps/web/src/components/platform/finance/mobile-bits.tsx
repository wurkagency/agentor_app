import type { Growth } from '@agentor/ui';
import { MobileCard, TrendPill } from '@agentor/ui/mobile';
import type { ReactNode } from 'react';
import { initials } from '@/server/platform-data';

// Server-safe pieces shared by the mobile finance boards (MP18–MP23).

/** Two key figures side by side (MP18–MP22). */
export function KpiPair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

/**
 * Whole kroner with a small "kr." unit, as the desktop KPI cards: a six-figure amount at 22 px
 * then still fits half of a 360 px phone.
 */
export function KrValue({ value }: { value: string }) {
  return (
    <>
      {value}
      <span className="text-meta font-semibold"> kr.</span>
    </>
  );
}

/** The small key figure on the finance boards: label + trend, 20/700 value, one meta line. */
export function SmallKpi({
  label,
  trend,
  value,
  meta,
}: {
  label: string;
  trend?: Growth | undefined;
  value: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <MobileCard className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-meta font-medium text-fg-2">{label}</span>
        {trend && <TrendPill growth={trend} />}
      </div>
      <strong className="text-section font-bold tabular">{value}</strong>
      {meta && <span className="truncate text-micro text-fg-2">{meta}</span>}
    </MobileCard>
  );
}

/**
 * A key-value line whose key is a name (a customer, a supporter, a case): the key truncates and
 * the figures keep their width, so long names never push the row wider than the phone.
 */
export function NameValue({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 pt-2 text-table leading-snug">
      <span className="min-w-0 truncate text-fg-2">{name}</span>
      <span className="flex-none text-right tabular">{children}</span>
    </div>
  );
}

/** 40 px initials tile for a customer heading (MP20); the name stands next to it. */
export function CustomerTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-10 flex-none place-items-center rounded-sm bg-bg-base text-micro font-semibold text-fg-1 shadow-ring-chip"
    >
      {initials(name)}
    </span>
  );
}
