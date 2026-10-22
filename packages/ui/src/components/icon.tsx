import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '../lib/cn';

export type IconSize = 14 | 16 | 18 | 24;

export interface IconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon;
  /** 16 tables and pills, 18 buttons and navigation, 24 empty states and mobile (§2.6). */
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
}

/** Lucide icon with the app's stroke (1.75) and size scale. */
export function Icon({ icon: Glyph, size = 16, label, className, ...rest }: IconProps) {
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={1.75}
      absoluteStrokeWidth={false}
      className={cn('flex-none', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
}
