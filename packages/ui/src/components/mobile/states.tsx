import { CircleX, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EmptyState, Loading, Skeleton } from '../empty';
import { Icon } from '../icon';
import { MobileCard } from './rows';
import type { LinkAs } from './shell';

// Server-safe. Content, skeleton, empty and error for every mobile list and card (designspec §5.4).
// The shapes follow Komponenter-Tilstande scaled to 390 px (PLAN-MOBILE G1, pending a board).

/** Skeleton rows in a card: circle + two lines per 56 px row. */
export function RowsSkeleton({
  rows = 3,
  label,
  leading = 'circle',
}: {
  rows?: number;
  /** "Indlæser…", announced once. */
  label: string;
  leading?: 'circle' | 'tile' | 'none';
}) {
  return (
    <Loading label={label}>
      <MobileCard>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex min-h-14 items-center gap-3 px-4 shadow-row-divider last:shadow-none"
          >
            {leading !== 'none' && (
              <Skeleton
                className={cn('flex-none', leading === 'circle' ? 'size-8 rounded-full' : 'size-7')}
              />
            )}
            <span className="flex flex-1 flex-col gap-1.5 py-2.5">
              <Skeleton className={cn('h-3.5', i % 2 ? 'w-1/2' : 'w-2/3')} />
              <Skeleton className="h-3 w-1/3" />
            </span>
          </div>
        ))}
      </MobileCard>
    </Loading>
  );
}

/** Skeleton for StatusHero. */
export function HeroSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <MobileCard>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-10 flex-none rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </span>
        </div>
      </MobileCard>
    </Loading>
  );
}

/** Skeletons for FlowCards. */
export function CardsSkeleton({ cards = 3, label }: { cards?: number; label: string }) {
  return (
    <Loading label={label}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md bg-surface px-4 py-3.5 shadow-sm">
            <span className="flex items-center justify-between">
              <span className="flex gap-1.5">
                <Skeleton className="size-6.5" />
                <Skeleton className="size-6.5" />
              </span>
              <Skeleton className="h-6 w-16 rounded-full" />
            </span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Skeletons for the two KPI cards (MobileKpi + MobileRing). */
export function KpiSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <div className="grid grid-cols-2 gap-2.5">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="grid grid-rows-m-kpi gap-y-1 rounded-md bg-surface px-3.5 py-3 shadow-sm"
          >
            <Skeleton className="h-3 w-2/3 self-center" />
            <Skeleton className="h-5.5 w-1/2 self-center" />
            <Skeleton className="h-6 w-full self-center" />
            <Skeleton className="h-2.5 w-3/4 self-center" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Empty list in a card: icon, title, explanation and an optional action. */
export function MobileEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <MobileCard>
      <EmptyState icon={icon} title={title} action={action} className="px-5 py-8">
        {children}
      </EmptyState>
    </MobileCard>
  );
}

/** "Kunne ikke hente data · Prøv igen" in a card. Retry reloads via a link or calls back. */
export function MobileError({
  message,
  retryLabel,
  onRetry,
  retryHref,
  linkAs: L = 'a',
}: {
  message: ReactNode;
  retryLabel: string;
  onRetry?: () => void;
  retryHref?: string;
  linkAs?: LinkAs;
}) {
  const btn =
    'touch-target inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border-0 bg-white px-4 font-sans text-table font-semibold text-fg-1 no-underline shadow-ring-strong';
  return (
    <MobileCard>
      <div role="alert" className="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-error-bg">
          <Icon icon={CircleX} size={24} className="text-error-fg" />
        </span>
        <p className="m-0 text-body">{message}</p>
        {retryHref ? (
          <L href={retryHref} className={btn}>
            <Icon icon={RefreshCw} size={16} />
            {retryLabel}
          </L>
        ) : (
          <button type="button" onClick={onRetry} className={btn}>
            <Icon icon={RefreshCw} size={16} />
            {retryLabel}
          </button>
        )}
      </div>
    </MobileCard>
  );
}
