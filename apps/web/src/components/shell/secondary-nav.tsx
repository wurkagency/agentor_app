'use client';

import { cn } from '@agentor/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface SecondaryItem {
  href: string;
  label: string;
  count?: number;
  /** Exact match only (for section roots such as /integrations). */
  exact?: boolean;
}

/**
 * Secondary pill navigation row (App-skal-B): 56 px with a top hairline, pills 36 px 13/500,
 * active white with shadow-sm. The right side holds the transaction meter.
 */
export function SecondaryBar({
  label,
  items,
  children,
  right,
}: {
  label: string;
  items?: SecondaryItem[];
  /** Custom left content instead of items (e.g. the period selector on Overblik). */
  children?: ReactNode;
  right?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex-none px-4 md:px-10">
      <div className="mx-auto flex h-subnav max-w-content items-center justify-between gap-6 shadow-hairline-t">
        {items ? (
          <nav aria-label={label} className="flex items-center gap-1 overflow-x-auto">
            {items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-table font-medium text-fg-2 no-underline',
                    'hover:bg-white-60 hover:text-fg-1',
                    active && 'bg-surface font-semibold text-fg-1 shadow-sm hover:bg-surface',
                  )}
                >
                  {item.label}
                  {item.count !== undefined && (
                    <span className="rounded-full bg-bg-base px-1.75 py-px text-micro font-semibold">
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="flex items-center gap-2">{children}</div>
        )}
        {right}
      </div>
    </div>
  );
}

/** Content area: max 1200 px on the same axis as the header (decision 1). */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={cn('flex-1 px-4 pb-10 pt-6 md:px-10', className)}>
      <div className="mx-auto flex max-w-content flex-col gap-6">{children}</div>
    </main>
  );
}

/** Page header: title 28/600, subtitle 14 fg-2, actions on the right. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex flex-col gap-1">
        {eyebrow && <p className="eyebrow m-0">{eyebrow}</p>}
        <h1 className="m-0 text-page">{title}</h1>
        {subtitle && <p className="m-0 text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-4">{actions}</div>}
    </div>
  );
}
