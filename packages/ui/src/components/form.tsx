'use client';

import { CircleAlert, Check, ChevronDown, Lock, Search } from 'lucide-react';
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
  Select as SelectPrimitive,
  Switch as SwitchPrimitive,
} from 'radix-ui';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/* ---- Field: label 13/500 above, help 12 below, error replaces help (§4) ------------------- */

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** Optional marker text, e.g. "Påkrævet". */
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
  /** Inline layout used in the inspector: label left (fixed width), control right (decision 8). */
  inline?: boolean;
}

export function Field({
  label,
  help,
  error,
  required,
  children,
  className,
  inline = false,
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const describedBy = error || help ? helpId : undefined;
  const invalid = Boolean(error);
  return (
    <div
      className={cn(
        inline ? 'grid field-inline items-start gap-x-4' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      <label
        htmlFor={id}
        className={cn('text-table font-medium text-fg-1', inline && 'pt-2 text-meta')}
      >
        {label}
        {required && <span className="sr-only"> (påkrævet)</span>}
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children({ id, describedBy, invalid })}
        {error ? (
          <p
            id={helpId}
            className="m-0 flex items-start gap-1.5 text-meta font-medium text-error-fg"
          >
            <Icon icon={CircleAlert} size={14} className="mt-px" />
            <span>{error}</span>
          </p>
        ) : help ? (
          <p id={helpId} className="m-0 text-meta text-fg-2">
            {help}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---- Input ---------------------------------------------------------------------------------- */

const inputBase = [
  'w-full min-w-0 box-border rounded-sm border bg-surface px-3 font-sans text-body text-fg-1',
  // Inputs use border-strong for a 3:1 outline (WCAG 1.4.11, PLAN.md Q22), fg on hover.
  'border-border-strong hover:border-fg-2',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-1',
  'disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-fg-2 disabled:hover:border-border-strong',
  'aria-invalid:border-error-fg aria-invalid:shadow-ring-error',
].join(' ');

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 40 px default, 36 in the inspector, 28 inside tables. */
  density?: 'default' | 'compact' | 'table';
  leadingIcon?: ReactNode;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, density = 'default', leadingIcon, mono, ...props },
  ref,
) {
  const h = density === 'table' ? 'h-7 text-table' : density === 'compact' ? 'h-9' : 'h-10';
  const readOnly = 'read-only:bg-bg-base read-only:hover:border-border-strong';
  if (leadingIcon) {
    return (
      <span className="relative flex w-full items-center">
        <span className="pointer-events-none absolute left-3 text-fg-2">{leadingIcon}</span>
        <input
          ref={ref}
          className={cn(inputBase, readOnly, h, 'pl-9', mono && 'font-mono text-mono', className)}
          {...props}
        />
      </span>
    );
  }
  return (
    <input
      ref={ref}
      className={cn(inputBase, readOnly, h, mono && 'font-mono text-mono', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }
>(function Textarea({ className, mono, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        inputBase,
        'min-h-24 py-2.5 read-only:bg-bg-base',
        mono && 'font-mono text-mono',
        className,
      )}
      {...props}
    />
  );
});

/** Pill search field (toolbar, 280 × 36, shadow-sm). */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, ...props }, ref) {
    return (
      <span className={cn('relative flex h-9 w-70 items-center', className)}>
        <Icon icon={Search} size={16} className="pointer-events-none absolute left-3.5 text-fg-2" />
        <input
          ref={ref}
          type="search"
          className="h-9 w-full rounded-full border-0 bg-surface pl-10 pr-4 font-sans text-table text-fg-1 shadow-sm"
          {...props}
        />
      </span>
    );
  },
);

/** Read-only value shown like a locked input. */
export function LockedValue({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 items-center gap-2 rounded-sm bg-bg-base px-3 text-body text-fg-2">
      <Icon icon={Lock} size={14} />
      {children}
    </span>
  );
}

/* ---- Select (Radix) -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-describedby'?: string | undefined;
  'aria-label'?: string;
  density?: 'default' | 'compact' | 'table';
  className?: string;
}

export function Select({
  id,
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  invalid,
  density = 'default',
  className,
  ...aria
}: SelectProps) {
  const h = density === 'table' ? 'h-7 text-table' : density === 'compact' ? 'h-9' : 'h-10';
  return (
    <SelectPrimitive.Root
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={aria['aria-describedby']}
        aria-label={aria['aria-label']}
        className={cn(inputBase, h, 'flex items-center justify-between gap-2 text-left', className)}
      >
        <SelectPrimitive.Value placeholder={<span className="text-fg-2">{placeholder}</span>} />
        <SelectPrimitive.Icon>
          <Icon icon={ChevronDown} size={16} className="text-fg-2" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-80 min-w-(--radix-select-trigger-width) overflow-hidden rounded-sm bg-surface p-1 shadow-card"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                {...(o.disabled ? { disabled: true } : {})}
                className="relative flex h-9 cursor-pointer select-none items-center gap-2 rounded-xs pl-8 pr-3 text-body outline-none data-highlighted:bg-bg-base data-disabled:cursor-not-allowed data-disabled:text-fg-2"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Icon icon={Check} size={16} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto text-meta text-fg-2">{o.hint}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ---- Switch: on = dark track, white knob, lime dot (not a lime track, §4) ------------------- */

export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'group relative inline-block h-5 w-9 flex-none cursor-pointer rounded-full border-0 p-0 box-border',
        'bg-white shadow-ring-off data-[state=checked]:bg-fg-1 data-[state=checked]:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'absolute left-1 top-1 block size-3 rounded-full bg-fg-2 transition-all duration-150',
          'data-[state=checked]:left-5 data-[state=checked]:top-0.75 data-[state=checked]:size-3.5 data-[state=checked]:bg-white',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-1.75 top-1.75 hidden size-1.5 rounded-full bg-primary group-data-[state=checked]:block"
      />
    </SwitchPrimitive.Root>
  );
});

/* ---- Checkbox: on = dark fill with lime check (Komponenter-Data) -------------------------------- */

export const Checkbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { size?: 16 | 18 }
>(function Checkbox({ className, size = 18, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'inline-grid flex-none cursor-pointer place-items-center rounded-2xs border-0 bg-white p-0 shadow-ring-off box-border',
        'data-[state=checked]:bg-fg-1 data-[state=checked]:text-primary data-[state=checked]:shadow-none',
        'data-[state=indeterminate]:bg-fg-1 data-[state=indeterminate]:text-primary data-[state=indeterminate]:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 16 ? 'size-4' : 'size-4.5',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check width={size - 4} height={size - 4} strokeWidth={2.5} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export const RadioGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadioPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadioPrimitive.Root ref={ref} className={cn('flex flex-col gap-2', className)} {...props} />
  );
});

/** Radio: 18 px, on = 5 px dark inset ring. */
export const Radio = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadioPrimitive.Item>
>(function Radio({ className, ...props }, ref) {
  return (
    <RadioPrimitive.Item
      ref={ref}
      className={cn(
        'inline-grid size-4.5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-white p-0 shadow-ring-off box-border',
        'data-[state=checked]:shadow-radio-on disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
});

/**
 * Radio card (D5-GaaLive, D11-Inviter): whole card is the hit area, selected = 2 px dark ring.
 */
export function RadioCard({
  value,
  title,
  description,
  disabled,
}: {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-node bg-surface p-4 shadow-ring-chip',
        'has-[[data-state=checked]]:shadow-ring-dark-2',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <Radio id={id} value={value} {...(disabled ? { disabled } : {})} className="mt-0.5" />
      <span className="flex flex-col gap-1">
        <span className="text-body font-semibold">{title}</span>
        {description && <span className="text-table text-fg-2">{description}</span>}
      </span>
    </label>
  );
}
