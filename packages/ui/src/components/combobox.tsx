'use client';

import { Command } from 'cmdk';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';
import { Popover, PopoverContent, PopoverTrigger } from './overlay';

export interface ComboboxOption {
  value: string;
  /** Account number etc., shown in monospace before the label. */
  code?: string;
  label: string;
  /** Marks a value that no longer exists in the destination ("Findes ikke længere"). */
  missing?: boolean;
}

export interface ComboboxProps {
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  missingText?: string;
  invalid?: boolean;
  disabled?: boolean;
  density?: 'default' | 'compact' | 'table';
  'aria-describedby'?: string | undefined;
  'aria-label'?: string;
  className?: string;
  footer?: ReactNode;
}

/** Searchable select for live lookups such as the chart of accounts (§4, Komponenter-Data). */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  missingText,
  invalid,
  disabled,
  density = 'default',
  className,
  footer,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const h =
    density === 'table' ? 'h-7 text-table bg-canvas' : density === 'compact' ? 'h-9' : 'h-10';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={aria['aria-describedby']}
          aria-label={aria['aria-label']}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-sm border border-border-strong bg-surface px-3 text-left font-sans text-body text-fg-1 box-border',
            'hover:border-fg-2 disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-fg-2',
            'aria-invalid:border-error-fg aria-invalid:shadow-ring-error',
            h,
            className,
          )}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              {selected.code && <span className="font-mono text-mono">{selected.code}</span>}
              <span className="truncate">{selected.label}</span>
              {selected.missing && <Icon icon={TriangleAlert} size={14} className="text-warn-fg" />}
            </span>
          ) : (
            <span className="truncate text-fg-2">{placeholder}</span>
          )}
          <Icon icon={ChevronDown} size={16} className="ml-auto text-fg-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 rounded-sm p-0">
        <Command loop>
          <Command.Input
            placeholder={searchPlaceholder}
            className="h-10 w-full border-0 bg-transparent px-3 font-sans text-body text-fg-1 shadow-hairline-b outline-none"
          />
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-table text-fg-2">{emptyText}</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.code ?? ''} ${o.label}`}
                disabled={o.missing ?? false}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-xs px-2 text-body data-[selected=true]:bg-bg-base data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-fg-2"
              >
                <span className="inline-flex w-4">
                  {o.value === value && <Icon icon={Check} size={16} />}
                </span>
                {o.code && <span className="font-mono text-mono">{o.code}</span>}
                <span className="truncate">{o.label}</span>
                {o.missing && missingText && (
                  <span className="ml-auto inline-flex items-center gap-1 text-meta text-warn-fg">
                    <Icon icon={TriangleAlert} size={14} />
                    {missingText}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.List>
          {footer && <div className="p-2 shadow-hairline-t">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
