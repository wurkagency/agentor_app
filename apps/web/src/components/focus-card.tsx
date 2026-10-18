import { cn } from '@agentor/ui';
import type { ReactNode } from 'react';

/** 480 px card used by every focus flow (D14-Login, D14-MFA). */
export function FocusCard({
  title,
  intro,
  icon,
  children,
  wide,
}: {
  title: ReactNode;
  intro?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={cn(
        'box-border flex w-full flex-col gap-5 rounded-md bg-surface p-8 shadow-sm',
        wide ? 'max-w-150' : 'max-w-focus',
      )}
    >
      {icon && (
        <span className="grid size-12 place-items-center rounded-full bg-bg-base">{icon}</span>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-stat-compact font-semibold tracking-snug">{title}</h1>
        {intro && <p className="m-0 text-fg-2">{intro}</p>}
      </div>
      {children}
    </section>
  );
}
