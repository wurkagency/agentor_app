import { Logotype, cn } from '@agentor/ui';

/**
 * The Agentor logotype (docs/design/runde-1/logos/agentor-logotype.svg) as inline SVG in the text
 * colour, so it is dark on light and white on navy like the boards. 24 px high in the app shell,
 * 22 px in the Platform header, 28 px on the focus flows.
 */
export function Logo({
  size = 'default',
  className,
}: {
  size?: 'default' | 'platform' | 'focus';
  className?: string;
}) {
  return (
    <Logotype
      label="Agentor"
      className={cn(
        'text-fg-1',
        size === 'focus' ? 'h-7' : size === 'platform' ? 'h-5.5' : 'h-6',
        className,
      )}
    />
  );
}
