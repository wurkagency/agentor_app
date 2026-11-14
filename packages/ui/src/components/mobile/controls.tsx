import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import type { LinkAs } from './shell';

// Server-safe: no hooks. Event handlers come from client parents.

/* ---- Chip group: 32 px pills, active = dark fill (mobile ".chip.on"); hit area 44 ------------- */

export interface ChipItem {
  key: string;
  /** "Alle 6", "Problemer 2" as on the boards. */
  label: ReactNode;
  /** A filter that is a URL (shareable, survives reload). Without it the chip is a button. */
  href?: string;
  disabled?: boolean;
}

const CHIP =
  'touch-target inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border-0 px-3.5 font-sans text-table no-underline box-border';

function chipClass(on: boolean, disabled?: boolean) {
  return cn(
    CHIP,
    on
      ? 'bg-fg-1 font-semibold text-white'
      : 'cursor-pointer bg-white font-medium text-fg-1 shadow-ring-chip',
    disabled && 'cursor-not-allowed text-fg-2 shadow-ring-border',
  );
}

export function ChipGroup({
  label,
  items,
  value,
  onChange,
  wrap = false,
  center = false,
  linkAs: L = 'a',
  className,
}: {
  /** Group name for assistive tech, e.g. "Filter". */
  label: string;
  items: ChipItem[];
  value: string | null;
  onChange?: (key: string) => void;
  /** Wrap onto more lines (MP04 types) instead of scrolling sideways inside the group. */
  wrap?: boolean;
  center?: boolean;
  linkAs?: LinkAs;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex gap-2',
        wrap ? 'flex-wrap gap-1.5' : 'no-scrollbar -mx-4 overflow-x-auto px-4 py-1.5 -my-1.5',
        center && 'justify-center',
        className,
      )}
    >
      {items.map((c) => {
        const on = c.key === value;
        if (c.href && !c.disabled)
          return (
            <L
              key={c.key}
              href={c.href}
              className={chipClass(on)}
              {...(on ? { 'aria-current': 'true' } : {})}
            >
              {c.label}
            </L>
          );
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            disabled={c.disabled}
            onClick={onChange ? () => onChange(c.key) : undefined}
            className={chipClass(on, c.disabled)}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Switch (mobile): 44 × 26, on = dark track with a lime knob (MA11) -------------------------- */

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Accessible name; the row title usually. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onCheckedChange ? () => onCheckedChange(!checked) : undefined}
      className={cn(
        'touch-target relative h-6.5 w-11 flex-none cursor-pointer rounded-full border-0 p-0',
        checked ? 'bg-fg-1' : 'bg-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.75 block size-5 rounded-full transition-all duration-150',
          checked ? 'left-5.25 bg-primary' : 'left-0.75 bg-white',
        )}
      />
    </button>
  );
}

/* ---- BigButton: 52 px, full width, 15/600 (".big") ---------------------------------------------- */

export type BigButtonVariant = 'primary' | 'secondary' | 'dark' | 'destructive';

const BIG_VARIANT: Record<BigButtonVariant, string> = {
  primary: 'bg-primary hover:bg-primary-bright',
  secondary: 'bg-white shadow-ring-strong hover:bg-bg-base',
  dark: 'on-navy bg-navy text-on-navy hover:bg-fg-1',
  destructive: 'bg-white text-error-fg shadow-ring-error hover:bg-error-bg',
};

function bigClass(variant: BigButtonVariant, className?: string) {
  return cn(
    'flex h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 font-sans text-nav font-semibold text-fg-1 no-underline box-border',
    'disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-fg-2 disabled:shadow-none',
    'aria-disabled:cursor-not-allowed aria-disabled:bg-bg-base aria-disabled:text-fg-2 aria-disabled:shadow-none',
    BIG_VARIANT[variant],
    className,
  );
}

export interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BigButtonVariant;
  icon?: LucideIcon | undefined;
  /** Spinner and aria-busy; pass the "…ing" label as children. */
  loading?: boolean;
}

export function BigButton({
  variant = 'primary',
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: BigButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={bigClass(variant, className)}
      {...rest}
    >
      {loading ? (
        <Icon icon={LoaderCircle} size={18} className="animate-spin" />
      ) : (
        icon && <Icon icon={icon} size={18} />
      )}
      {children}
    </button>
  );
}

/** A BigButton that navigates (MA08 "Senere", MP04 "Annullér" on the board). */
export function BigButtonLink({
  href,
  variant = 'primary',
  icon,
  linkAs: L = 'a',
  className,
  children,
}: {
  href: string;
  variant?: BigButtonVariant;
  icon?: LucideIcon;
  linkAs?: LinkAs;
  className?: string;
  children: ReactNode;
}) {
  return (
    <L href={href} className={bigClass(variant, className)}>
      {icon && <Icon icon={icon} size={18} />}
      {children}
    </L>
  );
}
