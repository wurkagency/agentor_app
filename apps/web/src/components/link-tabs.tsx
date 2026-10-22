'use client';

import { cn } from '@agentor/ui';
import Link from 'next/link';

/** Page tabs as links: each tab is a URL (shareable, no panels to wire up). */
export function LinkTabs({
  label,
  items,
  active,
}: {
  label: string;
  items: { key: string; href: string; label: string }[];
  active: string;
}) {
  return (
    <nav aria-label={label} className="flex items-end gap-6 shadow-hairline-b">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          scroll={false}
          aria-current={active === i.key ? 'page' : undefined}
          className={cn(
            'pb-2.5 text-body font-semibold text-fg-2 no-underline hover:text-fg-1',
            active === i.key && 'text-fg-1 shadow-tab-active',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
