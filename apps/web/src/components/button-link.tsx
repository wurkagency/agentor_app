import { buttonVariants, cn } from '@agentor/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * A link that looks like a button. Server components use this instead of
 * `<Button asChild><Link/></Button>`: Slot can't clone a client-component element across the
 * server/client boundary, which left those links unstyled.
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'm',
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'dark' | 'destructive';
  size?: 'l' | 'm' | 's';
}) {
  return (
    <Link className={cn(buttonVariants({ variant, size }), 'no-underline', className)} {...props} />
  );
}
