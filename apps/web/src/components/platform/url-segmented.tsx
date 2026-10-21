import { cn } from '@agentor/ui';
import Link from 'next/link';

export interface UrlSegment {
  href: string;
  label: string;
  active: boolean;
}

/**
 * A view or period filter kept in the URL (README decision 24: views are filters, not menus):
 * the dark segmented control from S1/S6/S7 as links, so the choice can be shared, survives a
 * reload and is a plain navigation for assistive tech. The page announces the result in
 * <FilterStatus>.
 */
export function UrlSegmented({
  label,
  segments,
  className,
}: {
  label: string;
  segments: UrlSegment[];
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn('inline-flex gap-0.5 rounded-full bg-surface p-0.75 shadow-sm', className)}
    >
      {segments.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          replace
          scroll={false}
          aria-current={s.active ? 'true' : undefined}
          className={cn(
            'inline-flex h-7.5 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-table font-semibold text-fg-2 no-underline hover:text-fg-1',
            s.active && 'bg-fg-1 text-white hover:text-white',
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** Polite live region that tells screen readers which view or period the page now shows. */
export function FilterStatus({ children }: { children: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {children}
    </p>
  );
}

/** Builds a link to the current page with one parameter changed, keeping the others. */
export function withParam(
  path: string,
  params: Record<string, string | string[] | undefined>,
  changes: Record<string, string | null>,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && !(k in changes)) next.set(k, v);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null) next.set(k, v);
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}
