import { cn } from '@agentor/ui';
import { MOBILE_INPUT } from '@agentor/ui/mobile';
import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The boards' 48 px ".minp" as a native select (MP09 "Sag", MP14 "Knyt til sag"): the phone's own
 * picker, labelled by the MobileField around it.
 */
export function MobileSelect({
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <span className="relative flex">
      <select
        {...rest}
        className={cn(MOBILE_INPUT, 'cursor-pointer appearance-none pr-10', className)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        width={16}
        height={16}
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-2"
      />
    </span>
  );
}

/** ".minp" as a textarea (MP09 "Begrundelse", MP14 "Kort opsummering"). */
export function MobileTextarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cn(MOBILE_INPUT, 'h-auto resize-none py-2.5 leading-snug', className)}
    />
  );
}
