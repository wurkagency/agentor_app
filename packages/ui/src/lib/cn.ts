import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge about the custom token scales so conflicting classes resolve correctly.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'page',
            'section',
            'card',
            'body',
            'table',
            'meta',
            'micro',
            'nano',
            'nav',
            'mono',
            'stat',
            'stat-compact',
            'counter',
            'logo',
            'kpi',
            'kpi-unit',
            // Mobile (README decision 20).
            'm-logo',
            'm-title',
            'm-heading',
            'm-request',
            'm-hero',
            'm-kpi',
            'm-chat',
            'm-note',
            'm-caption',
            'm-axis',
          ],
        },
      ],
      shadow: [
        {
          shadow: [
            'sm',
            'card',
            'overlay',
            'hero',
            'ring-strong',
            'ring-chip',
            'ring-border',
            'dot-broken',
            'ring-off',
            'ring-dark',
            'ring-dark-2',
            'ring-lime',
            'ring-error',
            'ring-error-2',
            'hairline-t',
            'hairline-b',
            'hairline-l',
            'hairline-r',
            'tab-active',
            'row-selected',
            'cutout-canvas',
            'cutout-white',
            'card-error',
            'card-warn',
            'lime-dark',
            'port-selected',
            'port-drop',
            'radio-on',
            'tabbar',
            'row-divider',
            'modal',
            'none',
          ],
        },
      ],
      rounded: [
        {
          rounded: [
            '3xs',
            '2xs',
            'xs',
            'sm',
            'field',
            'node',
            'bubble',
            'md',
            'lg',
            'xl',
            'full',
            'none',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
