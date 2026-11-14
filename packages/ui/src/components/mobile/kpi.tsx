import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Growth } from '../dashboard';
import { MobileCard } from './rows';

// Server-safe: no hooks. Compact blocks only where a board shows them (README decision 20).

/* ---- TrendPill: ↑/↓ against the previous period, 20 px (MA02, MP05, MP06) -----------------------
   Green text on ok-bg is 4.4:1 at 11 px, under the 4.5:1 the plan requires, so the words are dark
   and only the arrow carries the colour (it is 4.4:1, above 3:1 for graphics). Red text passes. */

const TREND: Record<Growth['tone'], { pill: string; arrow: string }> = {
  good: { pill: 'bg-ok-bg text-fg-1', arrow: 'text-ok-fg' },
  bad: { pill: 'bg-error-bg text-error-fg', arrow: '' },
  neutral: { pill: 'bg-bg-base text-fg-1', arrow: '' },
};

export function TrendPill({ growth }: { growth: Growth }) {
  const arrow = growth.direction === 'up' ? '↑' : growth.direction === 'down' ? '↓' : '';
  const s = TREND[growth.tone];
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded-full px-1.75 text-micro font-semibold tabular',
        s.pill,
      )}
      {...(growth.label ? { 'aria-label': growth.label } : {})}
    >
      {arrow && (
        <span aria-hidden className={s.arrow}>
          {arrow}
        </span>
      )}
      {growth.text}
    </span>
  );
}

/* ---- Sparkline: line with a fading fill and an end dot (MA02 "Records i dag") -------------------- */

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function Sparkline({ data, id }: { data: number[]; id?: string }) {
  if (data.length < 2) return null;
  const w = 100;
  const h = 30;
  const top = 3.5;
  const bottom = 26.5;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = bottom - ((v - min) / span) * (bottom - top);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const gid = `spark-${id ?? hash(data.join(','))}`;
  const lastY = pts[pts.length - 1]![1];
  return (
    <div className="relative h-7.5 w-full" aria-hidden>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block size-full overflow-visible"
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-fg-1)" stopOpacity={0.18} />
            <stop offset="1" stopColor="var(--color-fg-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`M0,${h} L${line.replaceAll(' ', ' L')} L${w},${h} Z`} fill={`url(#${gid})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-fg-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The dot sits outside the stretched SVG so it stays round. */}
      <span
        className="absolute right-0 size-2.25 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-fg-1 box-border"
        style={{ top: `${(lastY / h) * 100}%` }}
      />
    </div>
  );
}

/* ---- MobileKpi: label + trend, value, sparkline, meta; lime "featured" variant (MA02) ------------ */

export function MobileKpi({
  label,
  trend,
  value,
  data,
  meta,
  featured = false,
  visual,
}: {
  label: string;
  trend?: Growth | undefined;
  value: ReactNode;
  /** Earlier periods for the sparkline. */
  data?: number[];
  meta?: ReactNode;
  featured?: boolean;
  /** Replaces the sparkline. */
  visual?: ReactNode;
}) {
  return (
    <MobileCard
      className={cn('grid min-w-0 grid-rows-m-kpi gap-y-1 px-3.5 py-3', featured && 'bg-hero')}
    >
      <div className="flex items-center justify-between gap-1.5 overflow-hidden whitespace-nowrap">
        <span className={cn('text-meta font-medium', featured ? 'text-fg-1' : 'text-fg-2')}>
          {label}
        </span>
        {trend && <TrendPill growth={trend} />}
      </div>
      <strong className="text-m-kpi tabular">{value}</strong>
      <div className="flex items-center">{visual ?? (data ? <Sparkline data={data} /> : null)}</div>
      {meta && (
        <span className={cn('truncate text-micro leading-4', featured ? 'text-fg-1' : 'text-fg-2')}>
          {meta}
        </span>
      )}
    </MobileCard>
  );
}

/* ---- MobileRing: 52 px ring with percent, value "af" limit (MA02 "Transaktioner") ---------------- */

export function MobileRing({
  label,
  ratio,
  percentLabel,
  value,
  of,
  meta,
}: {
  label: string;
  /** 0–1; clamped. */
  ratio: number;
  /** "71%". */
  percentLabel: string;
  value: ReactNode;
  /** "af 2.000". */
  of: ReactNode;
  meta?: ReactNode;
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, ratio));
  return (
    <MobileCard className="grid min-w-0 grid-rows-m-ring gap-y-1 px-3.5 py-3">
      <span className="text-meta font-medium text-fg-2">{label}</span>
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 44 44"
          className="block size-13 flex-none"
          role="img"
          aria-label={percentLabel}
        >
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke="var(--color-gauge-track)"
            strokeWidth={5}
          />
          {p > 0 && (
            <circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke="var(--color-fg-1)"
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={`${(p * c).toFixed(1)} ${c.toFixed(1)}`}
              transform="rotate(-90 22 22)"
            />
          )}
          <text
            x="22"
            y="26"
            textAnchor="middle"
            fontFamily="var(--font-sans)"
            fontSize="11"
            fontWeight="700"
            fill="var(--color-fg-1)"
            aria-hidden
          >
            {percentLabel}
          </text>
        </svg>
        <strong className="text-nav font-bold leading-tight tabular">
          {value}
          <br />
          <span className="text-meta font-medium text-fg-2">{of}</span>
        </strong>
      </div>
      {meta && <span className="truncate text-micro leading-4 text-fg-2">{meta}</span>}
    </MobileCard>
  );
}

/* ---- WeekBars: 7 days, today hatched, red cap on days with errors (MA02 "Sidste 7 dage") -------- */

export interface WeekDay {
  /** "tir.", "i dag". */
  label: string;
  records: number;
  errors: number;
  today?: boolean;
  /** Screen-reader line, e.g. "tirsdag: 1.050 records, ingen fejl". */
  description: string;
}

export function WeekBars({
  title,
  summary,
  days,
}: {
  title: string;
  /** "7.639 records · 3 fejl". */
  summary: ReactNode;
  days: WeekDay[];
}) {
  const max = Math.max(1, ...days.map((d) => d.records));
  const maxErr = Math.max(1, ...days.map((d) => d.errors));
  return (
    <MobileCard>
      <div className="flex flex-col gap-2.5 px-3.5 pb-2.5 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-meta font-medium text-fg-2">{title}</span>
          <span className="text-meta font-semibold">{summary}</span>
        </div>
        <ul className="sr-only">
          {days.map((d) => (
            <li key={d.label}>{d.description}</li>
          ))}
        </ul>
        <div className="flex items-end gap-2" aria-hidden>
          {days.map((d) => {
            // Bars fill 80 % of the 56 px box at the busiest day, like the board; the cap scales
            // with the day's errors up to 6 px of the box.
            const bar = d.records > 0 ? Math.max(4, (d.records / max) * 90) : 0;
            const cap = d.errors > 0 ? Math.max(5, (d.errors / maxErr) * 10.7) : 0;
            return (
              <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="flex h-14 w-full max-w-5.5 flex-col justify-end gap-0.5">
                  {cap > 0 && (
                    <div className="rounded-3xs bg-error-fg" style={{ height: `${cap}%` }} />
                  )}
                  {bar > 0 && (
                    <div
                      className={cn('rounded-2xs', d.today ? 'hatch-sm' : 'bg-fg-1')}
                      style={{ height: `${bar}%` }}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    'text-m-axis',
                    d.today ? 'font-semibold text-fg-1' : 'font-normal text-fg-2',
                  )}
                >
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </MobileCard>
  );
}

/* ---- KpiStrip: the page's key figures as compact cards in a row that scrolls sideways ----------
   For list pages whose board has no figures of their own (MP01, MP02, MP06, MP23): the same
   numbers as the desktop cards, 156 px wide, the first one on the lime hero ground. */

export interface KpiStripItem {
  label: string;
  value: ReactNode;
  trend?: Growth | undefined;
  meta?: ReactNode;
}

export function KpiStrip({ label, items }: { label: string; items: KpiStripItem[] }) {
  return (
    // Focusable, so the row can be scrolled from the keyboard as well (WCAG 2.1.1).
    <section
      aria-label={label}
      tabIndex={0}
      className="no-scrollbar -mx-4 -my-1 flex flex-none snap-x gap-2.5 overflow-x-auto px-4 py-1 outline-none focus-visible:shadow-ring-dark"
    >
      {items.map((k, i) => (
        <MobileCard
          key={k.label}
          className={cn(
            'flex w-39 flex-none snap-start flex-col gap-1 px-3.5 py-3',
            i === 0 && 'bg-hero',
          )}
        >
          <span className="flex items-center justify-between gap-1.5 overflow-hidden whitespace-nowrap">
            <span
              className={cn('truncate text-meta font-medium', i === 0 ? 'text-fg-1' : 'text-fg-2')}
            >
              {k.label}
            </span>
            {k.trend && <TrendPill growth={k.trend} />}
          </span>
          <strong className="truncate text-m-kpi tabular">{k.value}</strong>
          {k.meta && (
            <span
              className={cn(
                'line-clamp-2 text-micro leading-4',
                i === 0 ? 'text-fg-1' : 'text-fg-2',
              )}
            >
              {k.meta}
            </span>
          )}
        </MobileCard>
      ))}
    </section>
  );
}
