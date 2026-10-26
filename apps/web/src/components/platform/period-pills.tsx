'use client';

import { cn } from '@agentor/ui';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** Period choice as links in the secondary row (S7: Sidste 24 timer · 7 dage · 30 dage). */
export function PeriodPills({
  label,
  param,
  options,
  fallback,
}: {
  label: string;
  param: string;
  options: { value: string; label: string }[];
  fallback: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? fallback;
  return (
    <nav aria-label={label} className="flex items-center gap-1">
      {options.map((o) => {
        const next = new URLSearchParams(params.toString());
        next.set(param, o.value);
        const active = current === o.value;
        return (
          <Link
            key={o.value}
            href={`${pathname}?${next}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-table font-medium text-fg-2 no-underline hover:text-fg-1',
              active && 'bg-surface font-semibold text-fg-1 shadow-sm',
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
