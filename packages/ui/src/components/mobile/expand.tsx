import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import type { LinkAs } from './shell';

// Server-safe: no hooks. Patterns from the second round of mobile boards (MA16–MA35, MP08–MP23).

/* ---- ExpandCard: a row that folds out to details (details.xr) ----------------------------------- */

/**
 * Native <details>: keyboard and screen readers get expand/collapse for free, and it works
 * without JavaScript. Summary min 60 px, body with key-value rows and actions.
 */
export function ExpandCard({
  leading,
  control,
  title,
  meta,
  trailing,
  open,
  children,
  className,
}: {
  leading?: ReactNode;
  /**
   * An interactive control before the title (MA19 checkbox). It sits over the summary, not in it:
   * a control inside <summary> is a nested interactive element.
   */
  control?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Pill or value before the chevron. */
  trailing?: ReactNode;
  open?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-bubble bg-surface shadow-sm', className)}>
      {control && <div className="absolute left-1 top-2 z-10">{control}</div>}
      <details className="group" {...(open ? { open: true } : {})}>
        <summary
          className={cn(
            'flex min-h-15 cursor-pointer list-none items-center gap-2.5 py-2.5 pr-3.5 [&::-webkit-details-marker]:hidden',
            control ? 'pl-12' : 'pl-3.5',
          )}
        >
          {leading}
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <strong className="truncate text-body font-semibold">{title}</strong>
            {meta && <span className="truncate text-meta font-medium text-fg-2">{meta}</span>}
          </span>
          {trailing}
          <span className="flex text-fg-2 transition-transform duration-150 group-open:rotate-180">
            <Icon icon={ChevronDown} size={18} />
          </span>
        </summary>
        <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-0.5 shadow-hairline-gauge">
          {children}
        </div>
      </details>
    </div>
  );
}

/** One key-value line in an ExpandCard body (".kvr"): 13 px, key grey, value right-aligned. */
export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 pt-2 text-table leading-snug">
      <span className="flex-none text-fg-2">{k}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** Small action buttons under the key-value rows (40 px high). */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1.5">{children}</div>;
}

const SMALL_BTN = {
  secondary: 'bg-white shadow-ring-strong text-fg-1',
  primary: 'bg-primary text-fg-1',
  dark: 'on-navy bg-navy text-on-navy',
  destructive: 'bg-white text-error-fg shadow-ring-error',
} as const;

/** 40 px pill action inside cards (MA19 "Se kørsler", "Kør nu"). Link or button. */
export function CardButton({
  href,
  onClick,
  icon,
  variant = 'secondary',
  linkAs: L = 'a',
  disabled,
  type = 'button',
  children,
}: {
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  variant?: keyof typeof SMALL_BTN;
  linkAs?: LinkAs;
  disabled?: boolean;
  type?: 'button' | 'submit';
  children: ReactNode;
}) {
  const cls = cn(
    'touch-target inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border-0 px-4 font-sans text-table font-semibold no-underline',
    'disabled:cursor-not-allowed disabled:opacity-45',
    SMALL_BTN[variant],
  );
  const inner = (
    <>
      {icon && <Icon icon={icon} size={16} />}
      {children}
    </>
  );
  if (href && !disabled)
    return (
      <L href={href} className={cls}>
        {inner}
      </L>
    );
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  );
}

/* ---- Segmented control (".mseg"): equal buttons, active dark ------------------------------------ */

export function Segmented({
  label,
  items,
  value,
  onChange,
  linkAs: L = 'a',
  className,
}: {
  label: string;
  items: { key: string; label: ReactNode; href?: string }[];
  value: string;
  onChange?: (key: string) => void;
  linkAs?: LinkAs;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-0.5 rounded-full bg-white p-0.75 shadow-sm', className)}
    >
      {items.map((i) => {
        const on = i.key === value;
        const cls = cn(
          'touch-target flex h-8.5 flex-1 cursor-pointer items-center justify-center rounded-full border-0 font-sans text-table font-semibold no-underline',
          on ? 'bg-fg-1 text-white' : 'bg-transparent text-fg-2',
        );
        return i.href ? (
          <L key={i.key} href={i.href} className={cls} {...(on ? { 'aria-current': 'true' } : {})}>
            {i.label}
          </L>
        ) : (
          <button
            key={i.key}
            type="button"
            aria-pressed={on}
            onClick={onChange ? () => onChange(i.key) : undefined}
            className={cls}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Fields (".mlab" + ".minp"): label 13/600 over a 48 px input, 16 px text (no iOS zoom) ------ */

export function MobileField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-table font-semibold', className)}>
      {label}
      {children}
      {hint && !error && <span className="text-meta font-medium text-fg-2">{hint}</span>}
      {error && (
        <span role="alert" className="text-meta font-medium text-error-fg">
          {error}
        </span>
      )}
    </label>
  );
}

export const MOBILE_INPUT =
  'h-12 w-full min-w-0 rounded-field border border-border-strong bg-white px-3.5 font-sans text-m-input font-normal text-fg-1 box-border';

export function MobileInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(MOBILE_INPUT, className)} {...rest} />;
}

/* ---- Checkbox (".cb"): 22 px, radius 6, on = dark with a lime check ---------------------------- */

export function MobileCheckbox({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className="grid size-11 flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0"
    >
      <span
        aria-hidden
        className={cn(
          'grid size-5.5 place-items-center rounded-xs',
          checked ? 'bg-fg-1 text-primary' : 'bg-white shadow-ring-off',
        )}
      >
        {checked && <Icon icon={Check} size={14} />}
      </span>
    </button>
  );
}

/* ---- Selection bar: dark floating bar above the tab bar (MA19 "3 valgt") ------------------------ */

export function SelectionBar({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={typeof label === 'string' ? label : undefined}
      className="on-navy fixed inset-x-3 bottom-tabbar-gap z-30 flex items-center gap-2 rounded-md bg-fg-1 px-3 py-2.5 text-white shadow-card"
    >
      <strong className="flex-1 whitespace-nowrap text-m-chat">{label}</strong>
      {children}
    </div>
  );
}

/* ---- Callout: tinted note with icon, title, text and actions (MA21 limit, MA31, MP08) ---------- */

const CALLOUT = {
  warn: { box: 'bg-warn-bg', icon: 'text-warn-fg' },
  error: { box: 'bg-error-bg', icon: 'text-error-fg' },
  info: { box: 'bg-info-bg', icon: 'text-info-fg' },
  ok: { box: 'bg-ok-bg', icon: 'text-ok-fg' },
  lime: { box: 'bg-lime-pale', icon: 'text-fg-1' },
} as const;

export function MobileCallout({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: keyof typeof CALLOUT;
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const c = CALLOUT[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-bubble px-3.5 py-3', c.box)}>
      <span className={cn('flex pt-px', c.icon)}>
        <Icon icon={icon} size={18} />
      </span>
      <div className="flex flex-1 flex-col gap-0.5 leading-snug">
        <strong className="text-m-chat">{title}</strong>
        {children && <span className="text-meta font-medium text-fg-1">{children}</span>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
