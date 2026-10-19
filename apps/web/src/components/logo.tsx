import { cn } from '@agentor/ui';

/**
 * Wordmark "Agent" + "or" with a 2 px underline under "or", 24/700, −0.02em. No triangle
 * (README decision 5). Focus flows use the larger 28 px variant.
 */
export function Logo({
  size = 'default',
  className,
}: {
  size?: 'default' | 'focus';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block font-bold tracking-tight text-fg-1',
        size === 'focus' ? 'text-counter' : 'text-logo',
        className,
      )}
    >
      Agent<span className="border-b-2 border-current pb-px">or</span>
    </span>
  );
}
