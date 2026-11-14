import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/**
 * Dashboard blocks (README decision 19): every Platform overview starts with a row of key
 * figure cards. The first is highlighted (lime gradient, curve); the others carry one visual each
 * — a segmented bar with stroke ticks, a half-circle gauge or six small bars. Cards come large
 * (Finans) and compact (~120 px: Kunder, Supportsager, Tid, Fejl).
 */

export type GrowthTone = 'good' | 'bad' | 'neutral';

export interface Growth {
  direction: 'up' | 'down' | 'flat';
  text: string;
  /** Green when the change is good, red when bad, grey when neutral. */
  tone: GrowthTone;
  /** Screen-reader sentence, e.g. "4,5 % mere end sidste måned". */
  label?: string;
}

export function GrowthBadge({
  growth,
  onHero = false,
  compact = false,
}: {
  growth: Growth;
  onHero?: boolean;
  compact?: boolean;
}) {
  const arrow = growth.direction === 'up' ? '↑' : growth.direction === 'down' ? '↓' : '';
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full font-semibold tabular',
        compact ? 'h-5 px-1.5 text-micro' : 'h-5.5 px-2 text-meta',
        onHero
          ? 'bg-ink-10 text-fg-1'
          : growth.tone === 'good'
            ? 'bg-ok-bg text-ok-fg'
            : growth.tone === 'bad'
              ? 'bg-error-bg text-error-fg'
              : 'bg-bg-base text-fg-1',
      )}
      {...(growth.label ? { 'aria-label': growth.label } : {})}
    >
      {arrow && <span aria-hidden>{arrow}</span>}
      {growth.text}
    </span>
  );
}

export interface KpiCardProps {
  icon?: LucideIcon;
  /** Red icon for cards about problems (Forfaldent, Kræver opmærksomhed). */
  iconTone?: 'muted' | 'error';
  label: string;
  growth?: Growth | undefined;
  value: string;
  unit?: string;
  /** Highlighted first card: lime gradient. */
  hero?: boolean;
  compact?: boolean;
  /** The card's one visual: HeroCurve, SegmentBar, Gauge or MiniBars. */
  visual?: ReactNode;
  /** Split figures between value and visual (large cards), e.g. "141 / md." and "65 / år". */
  split?: ReactNode;
  /** Legend or detail line at the bottom. */
  footer?: ReactNode;
  className?: string;
}

export function KpiCard({
  icon,
  iconTone = 'muted',
  label,
  growth,
  value,
  unit,
  hero = false,
  compact = false,
  visual,
  split,
  footer,
  className,
}: KpiCardProps) {
  const head = (
    <div
      className={cn('flex min-w-0 items-center justify-between gap-2', compact ? 'h-5' : 'h-5.5')}
    >
      <span
        className={cn(
          'flex min-w-0 items-center gap-2 font-medium',
          compact ? 'text-table' : 'text-table',
          hero ? 'text-fg-1' : 'text-fg-2',
        )}
      >
        {icon && (
          <Icon
            icon={icon}
            size={16}
            className={cn(
              'flex-none',
              hero ? 'text-fg-1' : iconTone === 'error' ? 'text-error-fg' : 'text-fg-2',
            )}
          />
        )}
        <span className="truncate">{label}</span>
      </span>
      {growth && <GrowthBadge growth={growth} onHero={hero} compact={compact} />}
    </div>
  );
  const number = (
    <span
      className={cn(
        'block whitespace-nowrap tabular',
        compact ? 'flex-none' : 'truncate',
        compact ? 'text-stat-compact' : 'text-kpi',
      )}
    >
      {value}
      {unit && <span className="ml-1 align-super text-kpi-unit">{unit}</span>}
    </span>
  );
  const foot = (
    <div
      className={cn(
        'h-4.5 min-w-0 truncate text-micro font-medium leading-4.5',
        hero ? 'text-fg-1' : 'text-fg-2',
      )}
    >
      {footer}
    </div>
  );
  // One anatomy for every card (README decision 19): fixed rows, so cards in a row line up
  // whatever they show. Large: header, number, split figures, visual, footer. Compact (~120 px):
  // header, number with the visual to its right, footer.
  return (
    <section
      aria-label={label}
      className={cn(
        'flex min-w-0 flex-col',
        hero ? 'rounded-lg bg-hero shadow-hero' : 'rounded-md bg-surface shadow-sm',
        compact ? 'gap-1.5 px-4 py-3' : 'gap-3 px-5 py-4.5',
        className,
      )}
    >
      {head}
      {compact ? (
        <div className="flex h-11 items-end justify-between gap-3">
          {number}
          <div className="flex h-11 min-w-0 max-w-1/2 flex-1 items-center justify-end">
            {visual}
          </div>
        </div>
      ) : (
        <>
          {number}
          <div className="h-5 min-w-0">{split}</div>
          <div className="flex h-18 min-w-0 items-end">{visual}</div>
        </>
      )}
      {foot}
    </section>
  );
}

/** Two figures side by side under the number: "141 / md." left, "65 / år" right. */
export function KpiSplit({
  left,
  right,
}: {
  left: { value: string; suffix?: string };
  right?: { value: string; suffix?: string };
}) {
  const part = (p: { value: string; suffix?: string }) => (
    <span className="min-w-0 truncate whitespace-nowrap text-body tabular">
      <strong className="font-semibold">{p.value}</strong>
      {p.suffix && <span className="ml-1 text-meta font-medium text-fg-2">{p.suffix}</span>}
    </span>
  );
  return (
    <div className="flex min-w-0 justify-between gap-2">
      {part(left)}
      {right && part(right)}
    </div>
  );
}

/** Curve over earlier periods on the highlighted card; the last point is the current period. */
export function HeroCurve({ data, compact = false }: { data: number[]; compact?: boolean }) {
  if (data.length < 2) return null;
  const w = 220;
  const h = compact ? 36 : 56;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const ly = Number(pts[pts.length - 1]!.split(',')[1]);
  return (
    <div className={cn('relative w-full', compact ? 'h-9' : 'h-14')} aria-hidden>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block size-full overflow-visible"
      >
        <path d={`M0,${h} L${pts.join(' L')} L${w},${h} Z`} className="fill-ink-10" />
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke="var(--color-fg-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The dot sits outside the stretched SVG so it stays round. */}
      <span
        className={cn(
          'absolute right-0 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-fg-1',
          compact ? 'size-2.5' : 'size-3',
        )}
        style={{ top: `${(ly / h) * 100}%` }}
      />
    </div>
  );
}

export type SegmentTone = 'ink' | 'hatch' | 'muted' | 'error' | 'warn' | 'navy' | 'border';

const SEGMENT: Record<SegmentTone, string> = {
  ink: 'bg-fg-1',
  hatch: 'hatch',
  muted: 'bg-bg-base',
  error: 'bg-error-fg',
  warn: 'bg-warn-fg',
  navy: 'bg-navy',
  border: 'bg-border',
};

/**
 * Segmented bar: filled segments in proportion, the rest empty, a lime marker and stroke ticks
 * at the end (what is left of the period or the forecast).
 */
export function SegmentBar({
  segments,
  compact = false,
  label,
}: {
  segments: { value: number; tone: SegmentTone }[];
  compact?: boolean;
  label?: string;
}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const empty = segments.every((x) => x.value <= 0);
  return (
    <div
      className={cn('flex w-full items-stretch', compact ? 'h-3 gap-0.5' : 'h-8.5 gap-0.75')}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {empty && <span className="flex-1 rounded-xs bg-bg-base" />}
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <span
            key={i}
            className={cn(SEGMENT[s.tone], compact ? 'rounded-xs' : 'rounded-xs')}
            style={{ flexGrow: s.value / total, flexBasis: 0 }}
          />
        ))}
      <span
        className={cn('w-0.5 flex-none rounded-full bg-primary', compact ? '-my-0.75' : '-my-1')}
      />
      <span className="ticks w-1/6 flex-none" />
    </div>
  );
}

/**
 * Half-circle gauge with a lime dot at the value (0–100). It carries no number of its own: the
 * card's figure says it, so a value is never shown twice.
 */
export function Gauge({ percent, label }: { percent: number; label?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const len = Math.PI * 80;
  const a = Math.PI * (1 - p / 100);
  const cx = 90 + 80 * Math.cos(a);
  const cy = 90 - 80 * Math.sin(a);
  return (
    <svg
      viewBox="0 0 180 98"
      className="mx-auto block h-full w-auto"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path
        d="M10,90 A80,80 0 0 1 170,90"
        fill="none"
        stroke="var(--color-gauge-track)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d="M10,90 A80,80 0 0 1 170,90"
        fill="none"
        stroke="var(--color-fg-1)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${((len * p) / 100).toFixed(1)} ${len.toFixed(1)}`}
      />
      <circle
        cx={cx.toFixed(1)}
        cy={cy.toFixed(1)}
        r={8}
        fill="var(--color-primary)"
        stroke="var(--color-white)"
        strokeWidth={3}
      />
    </svg>
  );
}

/**
 * Small bars for the last periods: earlier ones grey, the last closed one dark, the current
 * (open) one hatched.
 */
export function MiniBars({
  items,
  compact = false,
}: {
  items: { label: string; value: number }[];
  compact?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={cn('flex w-full items-end', compact ? 'gap-1' : 'gap-1.5')} aria-hidden>
      {items.map((it, i) => {
        const current = i === items.length - 1;
        const previous = i === items.length - 2;
        return (
          <div key={it.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className={cn('flex w-full max-w-6.5 items-end', compact ? 'h-7' : 'h-12.5')}>
              <div
                className={cn(
                  'w-full rounded-xs',
                  current ? 'hatch-light shadow-ring-lime' : previous ? 'bg-fg-1' : 'bg-border',
                )}
                style={{ height: `${Math.max(8, (it.value / max) * 100)}%` }}
              />
            </div>
            {!compact && (
              <span className={cn('text-nano', current ? 'font-semibold text-fg-1' : 'text-fg-2')}>
                {it.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Legend under a visual: small swatches with labels. */
export function KpiLegend({ items }: { items: { tone: SegmentTone; label: string }[] }) {
  return (
    <div className="flex min-w-0 gap-x-3 overflow-hidden">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn('size-2 rounded-2xs', SEGMENT[it.tone])} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
