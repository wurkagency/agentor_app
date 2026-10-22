import type { Status } from '@agentor/core';
import {
  CircleCheck,
  CirclePause,
  CircleX,
  FilePen,
  FlaskConical,
  PencilLine,
  Radio,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/** Icon and colour per status (designspecifikation §2.2). The icon carries the colour. */
export const STATUS_STYLE: Record<
  Status,
  { icon: LucideIcon; fg: string; bg: string; dot: string }
> = {
  ok: { icon: CircleCheck, fg: 'text-ok-fg', bg: 'bg-ok-bg', dot: 'bg-ok-fg' },
  warn: { icon: TriangleAlert, fg: 'text-warn-fg', bg: 'bg-warn-bg', dot: 'bg-warn-fg' },
  error: { icon: CircleX, fg: 'text-error-fg', bg: 'bg-error-bg', dot: 'bg-error-fg' },
  broken: {
    icon: Unplug,
    fg: 'text-error-fg',
    bg: 'bg-error-bg',
    dot: 'bg-error-fg shadow-dot-broken',
  },
  paused: { icon: CirclePause, fg: 'text-paused-fg', bg: 'bg-paused-bg', dot: 'bg-paused-fg' },
  info: { icon: FlaskConical, fg: 'text-info-fg', bg: 'bg-info-bg', dot: 'bg-info-fg' },
  draft: {
    icon: PencilLine,
    fg: 'text-paused-fg',
    bg: 'bg-transparent border border-dashed border-border-strong',
    dot: 'border border-dashed border-fg-2',
  },
};

export interface StatusPillProps {
  status: Status;
  /** The status word ("Aktiv", "Fejl") plus optional detail ("Fejl · siden 14:02"). */
  children: ReactNode;
  /** Dot + text, for sub-rows and dense lists. */
  compact?: boolean;
  className?: string;
}

/** Status is always icon (or dot) + text + colour, never colour alone (§5.1). */
export function StatusPill({ status, children, compact = false, className }: StatusPillProps) {
  const s = STATUS_STYLE[status];
  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-meta font-semibold whitespace-nowrap',
          className,
        )}
        data-status={status}
      >
        <span className={cn('size-2 flex-none rounded-full box-border', s.dot)} aria-hidden />
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-meta font-semibold text-fg-1 box-border',
        s.bg,
        className,
      )}
      data-status={status}
    >
      <Icon icon={s.icon} size={14} className={s.fg} />
      {children}
    </span>
  );
}

export type RunMode = 'live' | 'draft' | 'test';

const MODE_STYLE: Record<RunMode, { icon: LucideIcon; className: string }> = {
  live: { icon: Radio, className: 'bg-navy text-on-navy' },
  draft: { icon: FilePen, className: 'bg-white shadow-ring-chip' },
  test: { icon: FlaskConical, className: 'bg-info-bg' },
};

export interface ModeBadgeProps {
  mode: RunMode;
  /** "Live", "Kladde" or "Test". */
  children: ReactNode;
  /** 20 px variant used inside editor nodes. */
  small?: boolean;
  className?: string;
}

/** Tilstand: how a route writes (designspecifikation §2.3). Shown next to, not instead of, status. */
export function ModeBadge({ mode, children, small = false, className }: ModeBadgeProps) {
  const m = MODE_STYLE[mode];
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-semibold text-fg-1 box-border',
        small ? 'h-5 gap-1 px-2 text-micro' : 'h-badge gap-1 px-2 text-meta',
        m.className,
        className,
      )}
      data-mode={mode}
    >
      <Icon icon={m.icon} size={14} className="size-3" />
      {children}
    </span>
  );
}
