'use client';

import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import type { LinkAs } from './shell';

/* ---- MobileTabBar v3 (MX1, MX2; PLAN-2026-10-21 §7) ------------------------------------------------
   A floating 56 px pill, 14 px from the sides and 6 px above the home indicator. Inactive tabs are
   a 21 px icon in a 44 × 44 target with an aria-label; the active tab shows its icon and label on a
   pill and carries aria-current. Hidden while the on-screen keyboard is open. */

export interface TabItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

const TEXT_ENTRY =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * True while the user is typing: a text field has focus, or the visual viewport has shrunk below
 * 75 % of the layout height (the keyboard on phones that don't resize the layout).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const el = document.activeElement;
      const typing = el instanceof Element && el.matches(TEXT_ENTRY);
      const shrunk = vv ? vv.height < window.innerHeight * 0.75 : false;
      setOpen(typing || shrunk);
    };
    // focusout fires before the next element is focused; check once focus has settled.
    const later = () => requestAnimationFrame(update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    vv?.addEventListener('resize', update);
    update();
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
      vv?.removeEventListener('resize', update);
    };
  }, []);
  return open;
}

export function MobileTabBar({
  items,
  active,
  label,
  variant = 'app',
  linkAs: L = 'a',
  fixed = true,
  className,
}: {
  items: TabItem[];
  /** Key of the active tab, or null when none is (e.g. a page reached from the bell). */
  active: string | null;
  /** "Hovedmenu". */
  label: string;
  /** `app`: white (MX1). `platform`: navy (MX2). */
  variant?: 'app' | 'platform';
  linkAs?: LinkAs;
  /** Fixed over the bottom of the viewport (the app); static in previews. */
  fixed?: boolean;
  className?: string;
}) {
  const keyboard = useKeyboardOpen();
  const navy = variant === 'platform';
  const hidden = fixed && keyboard;
  return (
    <div
      className={cn(
        'z-30 px-3.5',
        fixed && 'fixed inset-x-0 bottom-tabbar',
        'motion-safe:transition motion-safe:duration-200',
        hidden && 'pointer-events-none invisible translate-y-4 opacity-0',
        className,
      )}
      data-keyboard={hidden ? 'open' : undefined}
    >
      <nav
        aria-label={label}
        className={cn(
          'mx-auto box-border flex h-14 max-w-tabbar items-center justify-between rounded-full px-tabbar',
          navy ? 'on-navy bg-navy shadow-tabbar-navy' : 'bg-white shadow-tabbar-float',
        )}
      >
        {items.map((t) =>
          t.key === active ? (
            <L
              key={t.key}
              href={t.href}
              aria-current="page"
              className={cn(
                'touch-target inline-flex h-10 flex-none items-center gap-2 rounded-full px-tab-active text-nav font-bold tracking-tight whitespace-nowrap no-underline',
                navy ? 'bg-white-10 text-on-navy' : 'bg-tab-pill text-fg-1',
              )}
            >
              <Icon icon={t.icon} size={24} className="size-5.5" />
              {t.label}
            </L>
          ) : (
            <L
              key={t.key}
              href={t.href}
              aria-label={t.label}
              className={cn(
                'grid size-11 flex-none place-items-center rounded-full no-underline',
                navy ? 'text-on-navy-82' : 'text-fg-3',
              )}
            >
              <Icon icon={t.icon} size={24} className="size-5.25" />
            </L>
          ),
        )}
      </nav>
    </div>
  );
}
