'use client';

import { Check, ChevronRight, Copy } from 'lucide-react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import {
  forwardRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/* ---- Card: white, radius 16, shadow-sm, no border (§2.5) ------------------------------------------- */

export function Card({
  className,
  padding = 'default',
  ...props
}: HTMLAttributes<HTMLElement> & { padding?: 'default' | 'compact' | 'none' }) {
  return (
    <section
      className={cn(
        'rounded-md bg-surface shadow-sm',
        padding === 'default' ? 'p-6' : padding === 'compact' ? 'p-4' : '',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  meta,
  action,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-card">{title}</h2>
        {meta && <p className="m-0 text-meta font-medium text-fg-2">{meta}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---- Table primitives (Komponenter-Data): header 40, row 44, sub-row 36, dark headers (decision 7) -- */

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-table', className)} {...props} />;
}

export function Th({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap border-b border-border px-3 text-left text-meta font-semibold text-fg-1',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export const Tr = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; sub?: boolean; interactive?: boolean }
>(function Tr({ className, selected, sub, interactive, ...props }, ref) {
  return (
    <tr
      ref={ref}
      aria-selected={selected}
      data-sub={sub || undefined}
      className={cn(
        'group/row',
        sub && 'bg-subrow',
        interactive && 'hover:bg-row-hover focus-within:bg-row-hover',
        selected && 'bg-row-hover [&>td:first-child]:shadow-row-selected',
        className,
      )}
      {...props}
    />
  );
});

export function Td({
  className,
  numeric,
  sub,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; sub?: boolean }) {
  return (
    <td
      className={cn(
        'whitespace-nowrap border-b border-border px-3 align-middle',
        sub ? 'h-9' : 'h-11',
        numeric && 'tabular text-right',
        className,
      )}
      {...props}
    />
  );
}

/** Row actions: visible on hover and always on focus (§4 DataTable). */
export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---- KeyValueList: label 12 fg-2, value 13 fg-1 -------------------------------------------------------- */

export function KeyValueList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('m-0 grid grid-cols-kv items-baseline gap-x-4 gap-y-2.5', className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="m-0 text-meta text-fg-2">{it.label}</dt>
          <dd className="m-0 text-table">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- UsageMeter: 8 px track, lime fill; over 80 % the fill turns warn with text (§4) ---------------- */

export function UsageMeter({
  label,
  valueText,
  used,
  limit,
  warnText,
  tone = 'light',
  className,
}: {
  label: ReactNode;
  /** e.g. "1.420 / 2.000" or "2 / alle". */
  valueText: ReactNode;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** Shown when the meter is above 80 %. */
  warnText?: ReactNode;
  tone?: 'light' | 'navy';
  className?: string;
}) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warn = limit !== null && pct > 80;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3 text-table">
        <span className={cn('font-medium', tone === 'navy' ? 'text-on-navy' : 'text-fg-1')}>
          {label}
        </span>
        <span
          className={cn('tabular font-semibold', tone === 'navy' ? 'text-on-navy' : 'text-fg-1')}
        >
          {valueText}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={typeof label === 'string' ? label : undefined}
        className={cn(
          'h-2 overflow-hidden rounded-full',
          tone === 'navy' ? 'bg-white-14' : 'bg-bg-base',
        )}
      >
        <div
          className={cn(
            'h-2 rounded-full',
            warn ? 'bg-warn-fg' : 'bg-primary',
            limit === null && 'w-0',
          )}
          style={limit === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {warn && warnText && <p className="m-0 text-meta font-medium text-warn-fg">{warnText}</p>}
    </div>
  );
}

/* ---- Avatar / UserChip ---------------------------------------------------------------------------------- */

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}

/**
 * Initials in a circle, or the person's profile photo when `src` is given (/api/avatar/<id>,
 * PR1/D15). Decorative: the name is always next to it.
 */
export function Avatar({
  name,
  size = 28,
  tone = 'light',
  src,
  className,
}: {
  name: string;
  size?: 28 | 32 | 40;
  tone?: 'light' | 'navy' | 'support';
  src?: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-grid flex-none place-items-center overflow-hidden rounded-full font-semibold',
        size === 28
          ? 'size-7 text-micro'
          : size === 32
            ? 'size-8 text-micro'
            : 'size-10 text-table',
        tone === 'navy'
          ? 'bg-navy text-on-navy'
          : tone === 'support'
            ? 'bg-fg-1 text-primary'
            : 'bg-bg-base text-fg-1',
        className,
      )}
    >
      {initialsOf(name)}
      {src && <img src={src} alt="" className="absolute inset-0 size-full object-cover" />}
    </span>
  );
}

/* ---- Accordion "Avanceret": 40 px header, chevron, eyebrow text (§4) --------------------------------------- */

export function Advanced({
  label,
  children,
  open,
  onOpenChange,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Controlled so the caller can remember the state per user (§1.3). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const value = open === undefined ? undefined : open ? 'advanced' : '';
  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      {...(value !== undefined ? { value } : {})}
      onValueChange={(v) => onOpenChange?.(v === 'advanced')}
      className={className}
    >
      <AccordionPrimitive.Item value="advanced">
        <AccordionPrimitive.Header className="m-0">
          <AccordionPrimitive.Trigger className="group flex h-10 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-sans text-fg-2">
            <Icon
              icon={ChevronRight}
              size={16}
              className="transition-transform duration-200 group-data-[state=open]:rotate-90"
            />
            <span className="eyebrow">{label}</span>
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content className="flex flex-col gap-4 pb-2 pt-2">
          {children}
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  );
}

/* ---- Small helpers ----------------------------------------------------------------------------------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-xs bg-bg-base px-1.5 font-sans text-micro font-semibold text-fg-1">
      {children}
    </kbd>
  );
}

/** Id in monospace with a copy button (§9.3: "Id'er i monospace med kopiér-ikon"). */
export function MonoId({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-mono">{value}</span>
      <CopyButton value={value} label={copyLabel} copiedLabel={copiedLabel} />
    </span>
  );
}

export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-2 hover:bg-bg-base hover:text-fg-1"
    >
      <Icon icon={copied ? Check : Copy} size={14} />
    </button>
  );
}
