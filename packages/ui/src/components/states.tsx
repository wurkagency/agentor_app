'use client';

import { ChevronRight, CircleX, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { CopyButton } from './data';
import { Icon } from './icon';

/* ---- LoadError: "Kunne ikke hente data · Prøv igen" (§5.4) ----------------------------------------- */

export function LoadError({
  message,
  retryLabel,
  onRetry,
  className,
}: {
  message: ReactNode;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}
    >
      <span className="grid size-12 place-items-center rounded-full bg-error-bg">
        <Icon icon={CircleX} size={24} className="text-error-fg" />
      </span>
      <p className="m-0 text-body">{message}</p>
      <Button variant="secondary" size="s" icon={RefreshCw} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/* ---- ErrorCard: what happened, why, how to fix; developer details fold out (§4) ------------------- */

export interface ErrorCardProps {
  title: ReactNode;
  why: ReactNode;
  stepsTitle: ReactNode;
  steps: ReactNode[];
  actions?: ReactNode;
  /** Developer layer: error code and masked request/response. */
  details?: {
    label: ReactNode;
    code?: string;
    blocks: { title: ReactNode; body: string; copyLabel: string; copiedLabel: string }[];
  };
  className?: string;
}

export function ErrorCard({
  title,
  why,
  stepsTitle,
  steps,
  actions,
  details,
  className,
}: ErrorCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cn('flex flex-col gap-4 rounded-md bg-surface p-6 shadow-sm', className)}>
      <div className="flex items-start gap-3">
        <Icon icon={CircleX} size={18} className="mt-0.5 text-error-fg" />
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-card">{title}</h3>
          <p className="m-0 text-body">{why}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="m-0 eyebrow">{stepsTitle}</p>
        <ol className="m-0 list-decimal space-y-1.5 pl-5 text-body">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      {details && (
        <div className="flex flex-col gap-3 shadow-hairline-t pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-sans text-left"
          >
            <Icon
              icon={ChevronRight}
              size={16}
              className={cn('transition-transform duration-200', open && 'rotate-90')}
            />
            <span className="eyebrow text-fg-1">{details.label}</span>
            {details.code && (
              <span className="ml-auto font-mono text-mono text-fg-2">{details.code}</span>
            )}
          </button>
          {open &&
            details.blocks.map((b, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-meta font-medium text-fg-2">{b.title}</span>
                  <CopyButton value={b.body} label={b.copyLabel} copiedLabel={b.copiedLabel} />
                </div>
                <pre className="m-0 overflow-x-auto whitespace-pre rounded-sm bg-bg-base px-3.5 py-3 font-mono text-mono">
                  {b.body}
                </pre>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
