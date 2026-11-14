'use client';

import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';
import { Tooltip } from './overlay';

export interface Trend {
  direction: 'up' | 'down' | 'flat';
  /** e.g. "12 %" or "+38". Trend text is fg-1, never red/green (DESIGN-RULES §9). */
  text: string;
  /** Screen-reader sentence, e.g. "12 % flere end forrige periode". */
  label?: string;
}

export interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  trend?: Trend;
  /** 7–30 data points; the last point is drawn as a lime dot. */
  sparkline?: number[];
  /** Explains the number, e.g. that synced revenue is not booked revenue (§7.2). */
  tooltip?: string;
  variant?: 'white' | 'lime' | 'compact';
  footer?: ReactNode;
  className?: string;
}

/** Key figure card (Komponenter-Handlinger, D1). Label 13/500, number 40/700, unit 16/500. */
export function StatCard({
  label,
  value,
  unit,
  trend,
  sparkline,
  tooltip,
  variant = 'white',
  footer,
  className,
}: StatCardProps) {
  const lime = variant === 'lime';
  const compact = variant === 'compact';
  return (
    <section
      className={cn(
        'flex flex-col shadow-sm',
        lime ? 'rounded-lg bg-primary' : 'rounded-md bg-surface',
        compact ? 'gap-1.5 p-4' : 'gap-3 p-6',
        className,
      )}
      aria-label={label}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('text-table font-medium', lime ? 'text-fg-1' : 'text-fg-2')}>
          {label}
        </span>
        {tooltip && (
          <Tooltip content={tooltip}>
            <button
              type="button"
              className="inline-grid size-6 place-items-center rounded-full border-0 bg-transparent text-fg-2 hover:bg-bg-base"
              aria-label={tooltip}
            >
              <Icon icon={Info} size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="tabular">
        <span className={compact ? 'text-stat-compact' : 'text-stat'}>{value}</span>
        {unit && (
          <span className={cn('ml-1 text-card font-medium', lime ? 'text-fg-1' : 'text-fg-2')}>
            {unit}
          </span>
        )}
      </div>
      {(trend || (sparkline && sparkline.length > 1)) && (
        <div className="flex items-end justify-between gap-3">
          {trend ? (
            <span className="inline-flex items-center gap-1 text-table font-semibold text-fg-1">
              {trend.direction !== 'flat' && (
                <Icon icon={trend.direction === 'up' ? ArrowUpRight : ArrowDownRight} size={14} />
              )}
              <span aria-label={trend.label}>{trend.text}</span>
            </span>
          ) : (
            <span />
          )}
          {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} onLime={lime} />}
        </div>
      )}
      {footer}
    </section>
  );
}

/**
 * 72 × 32 line in fg-3 with a lime last point (dark on lime cards). Decorative: the number and
 * trend text carry the meaning, so it is hidden from assistive tech.
 */
export function Sparkline({ data, onLime = false }: { data: number[]; onLime?: boolean }) {
  const w = 72;
  const h = 32;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="flex-none">
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={onLime ? 'var(--color-fg-1)' : 'var(--color-fg-3)'}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={onLime ? 3 : 3.5}
        fill={onLime ? 'var(--color-fg-1)' : 'var(--color-primary)'}
        stroke={onLime ? 'none' : 'var(--color-fg-1)'}
        strokeWidth={1}
      />
    </svg>
  );
}
