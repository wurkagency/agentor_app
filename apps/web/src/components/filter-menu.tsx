'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Icon,
} from '@agentor/ui';
import { ChevronDown } from 'lucide-react';

/**
 * A filter chip that opens a single-choice menu (D2 "Status · Kilde · Destination · Tilstand").
 * Active (a value chosen) = lime fill, like FilterChip.
 */
export function FilterMenu<T extends string>({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
  allLabel: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3.5 font-sans text-table text-fg-1 box-border',
          current
            ? 'bg-primary font-semibold'
            : 'bg-surface font-medium shadow-ring-chip hover:bg-bg-base',
        )}
      >
        {current ? `${label}: ${current.label}` : label}
        <Icon icon={ChevronDown} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(v) => onChange(v === '' ? null : (v as T))}
        >
          <DropdownMenuRadioItem value="">{allLabel}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
