'use client';

import { cn } from '@agentor/ui';
import { useState } from 'react';

export interface MonthBar {
  label: string;
  subscription: number;
  support: number;
  forecast: boolean;
  /** Tooltip lines, already formatted. */
  title: string;
  detail: string;
  growth?: string;
}

export interface DayBar {
  label: string;
  value: number;
  cumulative: number;
  future: boolean;
  title: string;
}

/**
 * Omsætning pr. måned or pr. dag (F1, README decision 19). Months: stacked rounded bars, black
 * subscription and hatched lime support, the open month hatched as a forecast. Days: thin bars
 * with a line for the running total and a dashed forecast. Tooltips on hover and focus.
 */
export function RevenueChart({
  mode,
  months,
  days,
  ticks,
  forecastDays,
  label,
}: {
  mode: 'months' | 'days';
  months: MonthBar[];
  days: DayBar[];
  /** Axis labels from the top, e.g. ["60k", "45k", "30k", "15k", "0"]. */
  ticks: { label: string; value: number }[];
  /** Expected running total at month end for the dashed forecast (days). */
  forecastDays?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = ticks[0]?.value || 1;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="flex flex-col gap-2" role="figure" aria-label={label}>
      <div className="relative flex h-64 gap-2">
        <div className="flex w-9 flex-none flex-col justify-between pb-6 text-right text-micro text-fg-2">
          {ticks.map((t) => (
            <span key={t.label} className="leading-none">
              {t.label}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
            {ticks.map((t) => (
              <span key={t.label} className="block h-px w-full bg-border" />
            ))}
          </div>
          {mode === 'months' ? (
            <div className="absolute inset-x-0 top-0 bottom-0 flex items-stretch gap-2">
              {months.map((m, i) => (
                <button
                  type="button"
                  key={m.label}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${m.title}: ${m.detail}`}
                  className={cn(
                    'group relative flex min-w-0 flex-1 cursor-default flex-col items-center border-0 bg-transparent p-0 font-sans',
                  )}
                >
                  <span className="relative flex w-full flex-1 flex-col items-center justify-end pb-0">
                    <span
                      className={cn(
                        'flex w-full max-w-10 flex-col justify-end gap-0.5 rounded-xs',
                        hover === i && 'shadow-ring-dark',
                      )}
                      style={{ height: pct(m.subscription + m.support) }}
                    >
                      <span
                        className={cn(
                          'w-full rounded-xs',
                          m.forecast ? 'hatch-light shadow-ring-lime' : 'hatch',
                        )}
                        style={{ flexGrow: m.support, flexBasis: 0 }}
                      />
                      <span
                        className="w-full rounded-xs bg-fg-1"
                        style={{ flexGrow: m.subscription, flexBasis: 0 }}
                      />
                    </span>
                  </span>
                  <span
                    className={cn(
                      'h-6 pt-2 text-micro leading-none',
                      hover === i || m.forecast ? 'font-semibold text-fg-1' : 'text-fg-2',
                    )}
                  >
                    {m.label}
                  </span>
                  {hover === i && (
                    <span className="pointer-events-none absolute bottom-full z-10 mb-2 flex w-max flex-col gap-0.5 rounded-sm bg-surface px-3 py-2 text-left shadow-card">
                      <span className="flex items-center gap-2 text-card font-bold text-fg-1">
                        {m.title}
                        {m.growth && (
                          <span className="rounded-full bg-ok-bg px-1.5 text-micro font-semibold text-ok-fg">
                            {m.growth}
                          </span>
                        )}
                      </span>
                      <span className="text-micro text-fg-2">{m.detail}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <DayChart
              days={days}
              max={max}
              forecast={forecastDays}
              hover={hover}
              setHover={setHover}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DayChart({
  days,
  max,
  forecast,
  hover,
  setHover,
}: {
  days: DayBar[];
  max: number;
  forecast: number | undefined;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const n = days.length;
  const lastPast = days.reduce((a, d, i) => (d.future ? a : i), 0);
  const cumMax = Math.max(max, forecast ?? 0, ...days.map((d) => d.cumulative)) || 1;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => 100 - (v / cumMax) * 100;
  const line = days
    .slice(0, lastPast + 1)
    .map((d, i) => `${x(i).toFixed(2)},${y(d.cumulative).toFixed(2)}`)
    .join(' ');
  const last = days[lastPast];
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative flex-1">
        <div className="absolute inset-0 flex items-end gap-0.5">
          {days.map((d, i) => (
            <button
              type="button"
              key={d.label}
              aria-label={d.title}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center border-0 bg-transparent p-0"
            >
              <span
                className={cn('w-full max-w-2 rounded-full', d.future ? 'bg-border' : 'bg-fg-1')}
                style={{ height: `${Math.max(d.value > 0 ? 3 : 1, (d.value / max) * 100)}%` }}
              />
              {hover === i && (
                <span className="pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-sm bg-surface px-3 py-2 text-micro text-fg-1 shadow-card">
                  {d.title}
                </span>
              )}
            </button>
          ))}
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden
        >
          <polyline
            points={line}
            fill="none"
            stroke="var(--color-lime-deep)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {forecast !== undefined && last && (
            <line
              x1={x(lastPast)}
              y1={y(last.cumulative)}
              x2={x(n - 1)}
              y2={y(forecast)}
              stroke="var(--color-lime-deep)"
              strokeWidth={2}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="flex h-6 items-end gap-0.5 text-nano text-fg-2">
        {days.map((d, i) => (
          <span key={d.label} className="min-w-0 flex-1 text-center">
            {i % 5 === 0 || i === n - 1 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
