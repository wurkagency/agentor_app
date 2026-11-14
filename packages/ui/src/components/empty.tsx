import { Lock, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

// Server-safe: no 'use client', so server components can pass icon components as props.

/* ---- EmptyState: 24 px icon in a 48 px circle, title 16/600, text 14 fg-2, action (§4) --------- */

export interface EmptyStateProps {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-full bg-bg-base">
        <Icon icon={icon} size={24} />
      </span>
      <p className="m-0 text-card">{title}</p>
      {children && <div className="m-0 max-w-md text-body text-fg-2">{children}</div>}
      {action && <div className="mt-1 flex gap-2">{action}</div>}
    </div>
  );
}

/** "Ingen adgang" is an empty state with a lock (§5.4). */
export function NoAccessState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <EmptyState icon={Lock} title={title}>
      {children}
    </EmptyState>
  );
}

/* ---- Skeleton: bg-base pulse, off with reduced motion -------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('block animate-pulse rounded-sm bg-bg-base', className)} />
  );
}

/** Accessible wrapper: announces loading once, hides the shapes. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
