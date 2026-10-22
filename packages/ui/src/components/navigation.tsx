'use client';

import { ChevronDown, X } from 'lucide-react';
import { Tabs as TabsPrimitive, ToggleGroup } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/* ---- FilterChip: pill 32, inactive = 1 px ring, active = lime fill 600 (§4) ------------------- */

export interface FilterChipProps {
  active?: boolean;
  count?: number;
  onClick?: () => void;
  /** Shows a remove cross; the chip label stays clickable. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Shows a chevron: the chip opens a filter menu. */
  menu?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function FilterChip({
  active,
  count,
  onClick,
  onRemove,
  removeLabel,
  menu,
  disabled,
  children,
  className,
}: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center rounded-full text-table box-border',
        active
          ? 'bg-primary font-semibold'
          : 'bg-surface font-medium shadow-ring-chip hover:bg-bg-base',
        disabled && 'text-fg-2 shadow-ring-border hover:bg-surface',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={menu ? undefined : active}
        aria-haspopup={menu ? 'menu' : undefined}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent font-sans text-fg-1 disabled:cursor-not-allowed disabled:text-fg-2',
          onRemove ? 'pl-3.5 pr-1' : 'px-3.5',
        )}
      >
        {children}
        {count !== undefined && (
          <span
            className={cn(
              'inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-micro font-semibold box-border',
              active ? 'bg-fg-1 text-white' : 'bg-bg-base text-fg-1',
            )}
          >
            {count}
          </span>
        )}
        {menu && !onRemove && <Icon icon={ChevronDown} size={14} />}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="mr-1.5 inline-grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1 hover:bg-white-60"
        >
          <Icon icon={X} size={14} />
        </button>
      )}
    </span>
  );
}

/* ---- Page tabs: 14/600, active dark with 2 px underline (§4) -------------------------------- */

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({
  className,
  dense,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { dense?: boolean }) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-end shadow-hairline-b', dense ? 'gap-4.5' : 'gap-6', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  dirty,
  dirtyLabel,
  dense,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  dirty?: boolean;
  dirtyLabel?: string;
  dense?: boolean;
}) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 pb-2.5 pt-0 font-sans font-semibold text-fg-2',
        dense ? 'text-table' : 'text-body',
        'hover:text-fg-1 data-[state=active]:text-fg-1 data-[state=active]:shadow-tab-active',
        className,
      )}
      {...props}
    >
      {children}
      {dirty && (
        // Unsaved changes are marked with a dot on the tab (§5.3).
        <span role="img" aria-label={dirtyLabel} className="size-1.5 rounded-full bg-fg-1" />
      )}
    </TabsPrimitive.Trigger>
  );
}

/* ---- Segmented control (pill group): light on surfaces, dark on canvas headers ---------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  tone = 'light',
  'aria-label': ariaLabel,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentedOption<T>[];
  /**
   * light: bg-base track, white active (Komponenter-Handlinger).
   * dark: white track with shadow, dark active (App-skal-B "Basic | Developer").
   */
  tone?: 'light' | 'dark';
  'aria-label': string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-0.5 rounded-full p-0.75',
        tone === 'light' ? 'bg-bg-base' : 'bg-surface shadow-sm',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-3.5 font-sans text-table font-semibold text-fg-2',
            tone === 'light'
              ? 'data-[state=on]:bg-surface data-[state=on]:text-fg-1 data-[state=on]:shadow-sm'
              : 'data-[state=on]:bg-fg-1 data-[state=on]:text-white',
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
