import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/**
 * Button (Komponenter-Handlinger). Always a pill. L (48) is only for the one primary CTA on a
 * page: 12/700 UPPERCASE +0.10em. M (36) and S (28) are dense, sentence case 13/600 and 12/600.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-0',
    'font-sans leading-none text-fg-1 cursor-pointer select-none',
    'transition duration-150 ease-standard',
    'disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-fg-2 disabled:shadow-none',
    'aria-disabled:cursor-not-allowed aria-disabled:bg-bg-base aria-disabled:text-fg-2 aria-disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary hover:bg-primary-bright active:shadow-ring-dark',
        secondary: 'bg-white shadow-ring-strong hover:bg-bg-base active:shadow-ring-dark',
        ghost:
          'bg-transparent hover:bg-bg-base active:bg-border disabled:bg-transparent aria-disabled:bg-transparent',
        dark: 'bg-navy text-on-navy hover:bg-fg-1 active:shadow-ring-lime on-navy',
        destructive:
          'bg-white text-error-fg shadow-ring-error hover:bg-error-bg active:bg-error-bg active:shadow-ring-error-2',
      },
      size: {
        l: 'h-12 px-7 text-meta font-bold uppercase tracking-cta',
        m: 'h-9 px-4 text-table font-semibold',
        s: 'h-7 px-3 text-meta font-semibold',
        icon: 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'm' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the child element (e.g. a link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and blocks clicks. Pass the "…ing" label as children. */
  loading?: boolean;
  icon?: LucideIcon | undefined;
  /** Required for icon-only buttons; also used as tooltip text by callers. */
  'aria-label'?: string | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    loading = false,
    icon,
    children,
    disabled,
    type,
    onClick,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  const iconSize = size === 'l' || size === 'icon' ? 18 : 16;
  const content = (
    <>
      {loading ? (
        <Icon icon={LoaderCircle} size={iconSize} className="animate-spin" />
      ) : icon ? (
        <Icon icon={icon} size={iconSize} />
      ) : null}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
    </>
  );
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled}
      aria-disabled={asChild && disabled ? true : undefined}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? 'button')}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {content}
    </Comp>
  );
});
