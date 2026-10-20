'use client';

import {
  Check,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Search,
  Sparkles,
  Store,
} from 'lucide-react';
import {
  forwardRef,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Slot } from 'radix-ui';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import { LogoImg, type LogoRef } from './shell';

/* ---- BigButton: 52 px pill on SU/OB, 48 px on MS/MO ("big2" / "big" on the boards) ------------- */

export interface SignupButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | undefined;
  loading?: boolean | undefined;
  mobile?: boolean | undefined;
  /** Fill the remaining width in a button row ("Fortsæt" next to "Tilbage"). */
  grow?: boolean | undefined;
  icon?: ReactNode | undefined;
  /** Renders the child (a link) with the button's look. */
  asChild?: boolean | undefined;
}

export const SignupButton = forwardRef<HTMLButtonElement, SignupButtonProps>(function SignupButton(
  {
    variant = 'primary',
    loading = false,
    mobile = false,
    grow = false,
    icon,
    asChild = false,
    className,
    children,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const classes = cn(
    'inline-flex items-center justify-center gap-2 rounded-full border-0 px-7 font-sans font-semibold text-fg-1 no-underline',
    'cursor-pointer transition duration-150 ease-standard box-border',
    mobile ? 'h-12 text-body' : 'h-13 text-su-input',
    variant === 'primary'
      ? 'bg-primary hover:bg-primary-bright'
      : 'bg-white shadow-ring-strong hover:bg-bg-base',
    'disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-fg-2 disabled:shadow-none',
    grow && 'flex-1',
    className,
  );
  if (asChild)
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <Icon icon={LoaderCircle} size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* ---- SignupInput: 48 px field, label 13/600 above (".lab" + ".inp2") -------------------------- */

export interface SignupInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  help?: ReactNode | undefined;
  error?: ReactNode | undefined;
  mobile?: boolean | undefined;
  /** Shown inside the field on the right (the "Fundet" pill). */
  adornment?: ReactNode | undefined;
}

export const SignupInput = forwardRef<HTMLInputElement, SignupInputProps>(function SignupInput(
  { label, help, error, mobile = false, adornment, className, id, ...props },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-table font-semibold">
        {label}
      </label>
      <span className="relative block">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || help ? helpId : undefined}
          className={cn(
            'box-border h-12 w-full min-w-0 rounded-field border bg-white px-3.5 font-sans text-fg-1',
            mobile ? 'text-m-input' : 'text-su-input',
            error ? 'border-error-fg' : 'border-border-strong',
            adornment ? 'pr-28' : '',
          )}
          {...props}
        />
        {adornment && <span className="absolute top-3 right-3">{adornment}</span>}
      </span>
      {error ? (
        <p
          id={helpId}
          role="alert"
          className="m-0 flex items-start gap-1.5 text-meta font-medium text-error-fg"
        >
          <Icon icon={CircleAlert} size={14} className="mt-px flex-none" />
          <span>{error}</span>
        </p>
      ) : help ? (
        <p id={helpId} className="m-0 text-meta font-medium text-fg-2">
          {help}
        </p>
      ) : null}
    </div>
  );
});

/** "eller med e-mail" between the SSO buttons and the form. */
export function OrDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-meta text-fg-2">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ---- SsoButton ------------------------------------------------------------------------------------ */

export interface SsoButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  provider: 'google' | 'microsoft';
  /** Visible text: "Fortsæt med Google" (SU1) or "Google" (MS1). */
  label: string;
  /** "Fortsæt med Google": always the full name for assistive tech (layout review). */
  accessibleLabel: string;
  logoUrl: string;
  loading?: boolean | undefined;
  mobile?: boolean | undefined;
}

export function SsoButton({
  provider,
  label,
  accessibleLabel,
  logoUrl,
  loading = false,
  mobile = false,
  disabled,
  className,
  ...props
}: SsoButtonProps) {
  return (
    <button
      type="button"
      data-provider={provider}
      aria-label={accessibleLabel}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'inline-flex w-full items-center justify-center rounded-full border-0 bg-white font-sans font-semibold text-fg-1',
        'cursor-pointer shadow-ring-strong transition duration-150 ease-standard hover:bg-bg-base box-border',
        'disabled:cursor-not-allowed disabled:text-fg-2',
        mobile ? 'h-12 gap-2 px-4 text-body' : 'h-13 gap-2.5 px-5 text-su-input',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Icon icon={LoaderCircle} size={18} className="animate-spin" />
      ) : (
        <img src={logoUrl} alt="" className={mobile ? 'size-4.5' : 'size-5'} />
      )}
      {label}
    </button>
  );
}

/* ---- CodeInput: 6 cells, paste, auto-advance (SU2/MS2) ------------------------------------------- */

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when all six digits are in. */
  onComplete?: (value: string) => void;
  /** Group label, "Kode". */
  label: string;
  /** "Ciffer 1 af 6" for each cell. */
  cellLabel: (index: number) => string;
  error?: boolean | undefined;
  disabled?: boolean | undefined;
  mobile?: boolean | undefined;
  describedBy?: string | undefined;
  length?: number | undefined;
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  cellLabel,
  error = false,
  disabled = false,
  mobile = false,
  describedBy,
  length = 6,
}: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const onInput = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '');
    if (!d) return;
    // Typing over a filled cell, or the browser's one-time-code autofill into one cell.
    const chars = digits.slice();
    for (let k = 0; k < d.length && i + k < length; k++) chars[i + k] = d[k]!;
    const clean = set(chars.join(''));
    refs.current[Math.min(i + d.length, length - 1, clean.length)]?.focus();
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const chars = digits.slice();
      if (chars[i]) chars[i] = '';
      else if (i > 0) {
        chars[i - 1] = '';
        refs.current[i - 1]?.focus();
      }
      onChange(chars.join('').slice(0, length));
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const clean = set(e.clipboardData.getData('text'));
    refs.current[Math.min(clean.length, length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn('flex', mobile ? 'gap-2' : 'gap-2.5')}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={length}
          disabled={disabled}
          aria-label={cellLabel(i)}
          aria-invalid={error || undefined}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            'box-border rounded-node border-0 bg-white text-center font-sans font-bold text-fg-1 caret-fg-1',
            mobile ? 'h-14 min-w-0 flex-1 text-su-code-m' : 'h-16 w-14 text-m-title',
            error ? 'shadow-ring-error-2' : d ? 'shadow-ring-chip' : 'shadow-ring-dark-2',
            'focus-visible:shadow-ring-dark-2',
          )}
        />
      ))}
    </div>
  );
}

/* ---- CvrField: idle, searching, found, not found, unavailable (SU3/MS3) ------------------------ */

export type CvrState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; name: string; address: string; industry?: string | null }
  | { kind: 'notFound' }
  | { kind: 'unavailable' };

export interface CvrFieldProps {
  value: string;
  onChange: (value: string) => void;
  onLookup: () => void;
  state: CvrState;
  label: string;
  texts: {
    found: string;
    searching: string;
    lookup: string;
    notFound: string;
    unavailable: string;
  };
  error?: ReactNode | undefined;
  mobile?: boolean | undefined;
}

export function CvrField({
  value,
  onChange,
  onLookup,
  state,
  label,
  texts,
  error,
  mobile = false,
}: CvrFieldProps) {
  const pill =
    state.kind === 'found' ? (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-bg px-2.5 text-meta font-semibold text-fg-1">
        <Icon icon={CircleCheck} size={14} className="text-ok-fg" />
        {texts.found}
      </span>
    ) : state.kind === 'searching' ? (
      <span
        className="inline-flex h-6 items-center gap-1.5 px-2.5 text-meta font-semibold text-fg-2"
        role="status"
      >
        <Icon icon={LoaderCircle} size={14} className="animate-spin" />
        {texts.searching}
      </span>
    ) : (
      <button
        type="button"
        onClick={onLookup}
        className="touch-target inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-bg-base px-2.5 font-sans text-meta font-semibold text-fg-1"
      >
        <Icon icon={Search} size={14} />
        {texts.lookup}
      </button>
    );
  const message =
    state.kind === 'notFound'
      ? texts.notFound
      : state.kind === 'unavailable'
        ? texts.unavailable
        : null;
  return (
    <div className="flex flex-col gap-3">
      <SignupInput
        label={label}
        value={value}
        mobile={mobile}
        inputMode="numeric"
        autoComplete="off"
        maxLength={11}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (/^\d{8}$/.test(value.replace(/\s/g, '')) && state.kind === 'idle') onLookup();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onLookup();
          }
        }}
        adornment={pill}
        error={error}
        help={message}
      />
      {state.kind === 'found' && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-md bg-surface shadow-sm',
            mobile ? 'px-3.5 py-3' : 'px-4 py-3.5',
          )}
          aria-live="polite"
        >
          <span
            className={cn(
              'grid flex-none place-items-center rounded-field bg-bg-base',
              mobile ? 'size-9' : 'size-10',
            )}
          >
            <Icon icon={Store} size={18} />
          </span>
          <span className="flex min-w-0 flex-col leading-snug">
            <strong className={mobile ? 'text-body' : ''}>{state.name}</strong>
            <span className="text-meta font-medium text-fg-2">
              {state.address}
              {!mobile && state.industry ? ` · ${state.industry}` : ''}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ---- SystemPicker: logo tiles, multi-select (SU3/MS3) --------------------------------------------- */

export interface SystemOption extends LogoRef {
  id: string;
  /** "På vej": selectable as interest; runs on dummy data until the connector ships (B5). */
  soon?: boolean | undefined;
}

export function SystemPicker({
  label,
  options,
  value,
  onChange,
  soonLabel,
  mobile = false,
}: {
  label: string;
  options: SystemOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  soonLabel?: string | undefined;
  mobile?: boolean | undefined;
}) {
  const id = useId();
  const toggle = (sid: string) =>
    onChange(value.includes(sid) ? value.filter((v) => v !== sid) : [...value, sid]);
  return (
    <div className="flex flex-col gap-2.5" role="group" aria-labelledby={id}>
      <span id={id} className="text-table font-semibold">
        {label}
      </span>
      <ul className={cn('m-0 grid list-none grid-cols-3 p-0', mobile ? 'gap-2' : 'gap-2.5')}>
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                aria-pressed={on}
                title={o.soon && soonLabel ? `${o.name} · ${soonLabel}` : undefined}
                onClick={() => toggle(o.id)}
                className={cn(
                  'relative w-full cursor-pointer border-0 bg-white font-sans font-semibold text-fg-1 box-border',
                  on ? 'shadow-ring-dark-2' : 'shadow-ring-border',
                  mobile
                    ? 'flex h-16 flex-col items-center justify-center gap-1 rounded-node text-m-caption'
                    : 'flex items-center gap-2.5 rounded-node px-3.5 py-3 text-body',
                )}
              >
                {mobile ? (
                  <LogoImg logo={o} size="sm" decorative />
                ) : (
                  <span className="grid size-8 flex-none place-items-center rounded-sm bg-white shadow-ring-border">
                    <LogoImg logo={o} size="sm" decorative />
                  </span>
                )}
                <span className="min-w-0 truncate">{o.name}</span>
                {on && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute grid place-items-center rounded-full bg-fg-1 text-primary',
                      mobile ? '-top-1.25 -right-1.25 size-4.5' : '-top-1.5 -right-1.5 size-5',
                    )}
                  >
                    <Icon icon={Check} size={14} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Single-choice chips ("Ordrer pr. måned"): dark when chosen. */
export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  mobile = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (v: string) => void;
  mobile?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <span id={id} className="text-table font-semibold">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className={cn('flex flex-wrap', mobile ? 'gap-1.5' : 'gap-2')}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                'touch-target inline-flex h-8 cursor-pointer items-center whitespace-nowrap rounded-full border-0 px-3.5 font-sans text-table box-border',
                on
                  ? 'bg-fg-1 font-semibold text-white'
                  : 'bg-white font-medium text-fg-1 shadow-ring-chip',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- BillingPeriodToggle (SU4/MS4) ---------------------------------------------------------------- */

export function BillingPeriodToggle({
  value,
  onChange,
  label,
  monthly,
  yearly,
  badge,
}: {
  value: 'month' | 'year';
  onChange: (v: 'month' | 'year') => void;
  /** "Betalingsperiode". */
  label: string;
  monthly: string;
  yearly: string;
  /** "2 måneder gratis". */
  badge?: string | undefined;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex gap-0.5 rounded-full bg-white p-0.75 shadow-sm"
      >
        {(
          [
            ['month', monthly],
            ['year', yearly],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'touch-target inline-flex h-7.5 cursor-pointer items-center rounded-full border-0 px-3.5 font-sans text-table font-semibold',
              value === v ? 'bg-fg-1 text-white' : 'bg-transparent text-fg-2',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {badge && (
        <span className="inline-flex h-5.5 items-center rounded-full bg-ok-bg px-2.5 text-meta font-semibold text-fg-1">
          {badge}
        </span>
      )}
    </div>
  );
}

/* ---- PlanCard: expanded (SU4 cards, MS4 recommended) and collapsed (MS4 rows) ------------------- */

export interface PlanCardProps {
  name: string;
  price: string;
  /** "/ år" or "/ md.". */
  per: string;
  /** "Svarer til 132,50 kr./md." */
  equivalent?: string | undefined;
  lines: { text: string; included: boolean }[];
  /** "Passer til 100–1.000 ordrer og 3 systemer." */
  fit?: string | undefined;
  /** "Anbefalet til jer". */
  badge?: string | undefined;
  selected: boolean;
  onSelect: () => void;
  variant: 'expanded' | 'collapsed';
  /** Collapsed row: "100 transaktioner/md. · hvert 15. min." */
  summary?: string | undefined;
  mobile?: boolean | undefined;
  /** Radio group name. */
  name_: string;
}

export function PlanCard({
  name,
  price,
  per,
  equivalent,
  lines,
  fit,
  badge,
  selected,
  onSelect,
  variant,
  summary,
  mobile = false,
  name_,
}: PlanCardProps) {
  const radio = (
    <span
      aria-hidden
      className={cn(
        'size-5.5 flex-none rounded-full',
        selected ? 'shadow-radio-on-lg' : 'shadow-ring-strong-2',
      )}
    />
  );
  const input = (
    <input
      type="radio"
      name={name_}
      checked={selected}
      onChange={onSelect}
      aria-label={name}
      className="sr-only"
    />
  );
  if (variant === 'collapsed')
    return (
      <label
        className={cn(
          'relative flex cursor-pointer items-center gap-3 rounded-md bg-surface px-4 py-3.5 shadow-sm',
          selected && 'shadow-plan-selected',
          'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg-1',
        )}
      >
        {input}
        {badge && <PlanBadge>{badge}</PlanBadge>}
        {radio}
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <strong className="text-su-input">{name}</strong>
          {summary && <span className="text-meta font-medium text-fg-2">{summary}</span>}
        </span>
        <strong className="whitespace-nowrap text-su-input">
          {price}
          {per}
        </strong>
      </label>
    );
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col rounded-md bg-surface shadow-sm',
        mobile ? 'gap-2.5 px-4 pt-4.5 pb-3.5' : 'gap-3 px-5 pt-5.5 pb-4.5',
        selected && 'shadow-plan-selected',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg-1',
      )}
    >
      {input}
      {badge && <PlanBadge>{badge}</PlanBadge>}
      <span className="flex items-center justify-between">
        <strong className={mobile ? 'text-su-plan-m' : 'text-su-plan'}>{name}</strong>
        {radio}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <strong className={cn('whitespace-nowrap', mobile ? 'text-su-price-m' : 'text-su-price')}>
          {price}
        </strong>
        <span className="text-meta font-medium text-fg-2">
          {per}
          {mobile && equivalent ? ` · ${equivalent}` : ''}
        </span>
      </span>
      {!mobile && equivalent && (
        <span className="-mt-2 text-meta font-medium text-fg-2">{equivalent}</span>
      )}
      <ul
        className={cn(
          'm-0 list-none p-0',
          mobile ? 'grid grid-cols-2 gap-x-2.5 gap-y-1.5' : 'flex flex-col gap-1.75',
        )}
      >
        {lines.map((l) => (
          <li
            key={l.text}
            className={cn(
              'flex items-start gap-2 text-table',
              l.included ? 'text-fg-1' : 'text-fg-2',
            )}
          >
            <Icon
              icon={Check}
              size={14}
              className={cn('mt-0.5 flex-none', l.included ? 'text-ok-fg' : 'text-fg-3')}
            />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {fit && <span className="text-meta font-medium text-fg-1">{fit}</span>}
    </label>
  );
}

function PlanBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -top-3 left-5 inline-flex h-5.5 items-center gap-1.25 rounded-full bg-primary px-2.5 text-meta font-semibold text-fg-1">
      <Icon icon={Sparkles} size={14} />
      {children}
    </span>
  );
}

/* ---- OrderSummary (SU5 white card on navy; MS5 navy card) -------------------------------------- */

export interface OrderSummaryProps {
  title: string;
  company: string;
  badge?: string | undefined;
  lines: { label: string; amount: string }[];
  total: { label: string; amount: string };
  note?: ReactNode | undefined;
  mobile?: boolean | undefined;
}

export function OrderSummary({
  title,
  company,
  badge,
  lines,
  total,
  note,
  mobile = false,
}: OrderSummaryProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col',
        mobile
          ? 'gap-2.5 rounded-md bg-navy p-4 text-on-navy'
          : 'max-w-signup-panel gap-3 rounded-order bg-white p-5.5 text-fg-1',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col leading-snug">
          <strong className={mobile ? 'text-su-input' : 'text-su-plan'}>{title}</strong>
          <span className={cn('text-meta', mobile ? 'text-on-navy-soft' : 'font-medium text-fg-2')}>
            {company}
          </span>
        </span>
        {badge && (
          <span className="inline-flex h-5.5 items-center rounded-full bg-primary px-2.5 text-meta font-semibold text-fg-1">
            {badge}
          </span>
        )}
      </div>
      <div
        className={cn(
          'flex flex-col',
          mobile ? 'gap-1.5 pt-2.5 shadow-hairline-t-navy' : 'gap-3 pt-3 shadow-hairline-t',
        )}
      >
        {lines.map((l) => (
          <div
            key={l.label}
            className={cn('flex justify-between', mobile ? 'text-m-chat' : 'text-body')}
          >
            <span>{l.label}</span>
            <span className="tabular">{l.amount}</span>
          </div>
        ))}
        <div
          className={cn(
            'flex justify-between font-bold',
            mobile ? 'text-su-input' : 'pt-3 text-su-lead shadow-hairline-t',
          )}
        >
          <span>{total.label}</span>
          <span className="tabular">{total.amount}</span>
        </div>
      </div>
      {note && (
        <span
          className={cn(
            mobile ? 'text-m-caption text-on-navy-soft' : 'text-meta font-medium text-fg-2',
          )}
        >
          {note}
        </span>
      )}
    </section>
  );
}

/* ---- TermsAcceptance: "Accept af betingelser", two required boxes (SU5/MS5) ------------------ */

export interface TermsAcceptanceProps {
  legend: string;
  items: {
    id: 'subscriptionTerms' | 'privacy';
    /** "Jeg accepterer" / "Jeg har læst". */
    lead: string;
    /** "Abonnementsbetingelser" / "Privatlivspolitik": opens the document. */
    link: string;
    onOpen: () => void;
    checked: boolean;
    onChange: (v: boolean) => void;
  }[];
  /** "Påkrævet" for screen readers next to the red asterisk. */
  requiredLabel: string;
  error?: string | undefined;
  mobile?: boolean | undefined;
}

export function TermsAcceptance({
  legend,
  items,
  requiredLabel,
  error,
  mobile = false,
}: TermsAcceptanceProps) {
  const errId = useId();
  // Unique per instance: desktop and mobile both render the form (Responsive).
  const uid = useId();
  return (
    <fieldset
      className="m-0 flex flex-col gap-2.5 border-0 p-0"
      aria-describedby={error ? errId : undefined}
    >
      <legend className={cn('p-0 text-table font-semibold', mobile ? 'mb-2' : 'mb-2.5')}>
        {legend}
      </legend>
      {items.map((it) => (
        <div
          key={it.id}
          className={cn('flex gap-2.5 text-body', mobile ? 'items-center' : 'items-start')}
        >
          <input
            id={`${uid}-${it.id}`}
            type="checkbox"
            checked={it.checked}
            required
            aria-required="true"
            onChange={(e) => it.onChange(e.target.checked)}
            className={cn(
              'peer m-0 flex-none cursor-pointer accent-fg-1',
              mobile ? 'size-5.5 touch-target' : 'mt-0.5 size-4.5',
            )}
          />
          <span>
            <label htmlFor={`${uid}-${it.id}`} className="cursor-pointer">
              {it.lead}{' '}
            </label>
            <button
              type="button"
              onClick={it.onOpen}
              className="cursor-pointer border-0 bg-transparent p-0 font-sans text-body font-semibold text-fg-1 underline"
            >
              {it.link}
            </button>{' '}
            <span aria-hidden className="text-error-fg">
              *
            </span>
            <span className="sr-only">{requiredLabel}</span>
          </span>
        </div>
      ))}
      {error && (
        <p
          id={errId}
          role="alert"
          className="m-0 flex items-center gap-1.5 text-meta font-medium text-error-fg"
        >
          <Icon icon={CircleAlert} size={14} />
          {error}
        </p>
      )}
    </fieldset>
  );
}
