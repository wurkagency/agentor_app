'use client';

import { cn } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * PlatformSubTabs (MP02, MP06, MP25 and the screens under them; PLAN-2026-10-21 §7): the
 * section's pages as underlined tabs under the top bar. Scrolls sideways when they don't fit and
 * keeps the active tab in view. Only on a section's list pages; detail pages have a back button.
 */
type Section = 'support' | 'finance' | 'admin';

const TABS: Record<Section, { key: string; href: string; match: (p: string) => boolean }[]> = {
  support: [
    {
      key: 'cases',
      href: '/platform/support/cases',
      match: (p) => under(p, '/platform/support/cases'),
    },
    {
      key: 'access',
      href: '/platform/support/access',
      match: (p) => under(p, '/platform/support/access'),
    },
    {
      key: 'errors',
      href: '/platform/support/errors',
      match: (p) => under(p, '/platform/support/errors'),
    },
    {
      key: 'time',
      href: '/platform/support/time',
      match: (p) => under(p, '/platform/support/time'),
    },
  ],
  finance: [
    { key: 'overview', href: '/platform/finance', match: (p) => p === '/platform/finance' },
    {
      key: 'subscriptions',
      href: '/platform/finance/subscriptions',
      match: (p) => under(p, '/platform/finance/subscriptions'),
    },
    {
      key: 'support',
      href: '/platform/finance/support',
      match: (p) => under(p, '/platform/finance/support'),
    },
    {
      key: 'invoicing',
      href: '/platform/finance/invoicing',
      match: (p) => under(p, '/platform/finance/invoicing'),
    },
  ],
  admin: [
    {
      key: 'status',
      href: '/platform/admin/status',
      match: (p) => under(p, '/platform/admin/status'),
    },
    {
      key: 'users',
      href: '/platform/admin/users',
      match: (p) => under(p, '/platform/admin/users'),
    },
    {
      key: 'product',
      href: '/platform/admin/product',
      match: (p) => under(p, '/platform/admin/product'),
    },
    {
      key: 'reports',
      href: '/platform/admin/reports/revenue',
      match: (p) => under(p, '/platform/admin/reports'),
    },
  ],
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

function sectionOf(path: string): Section | null {
  if (under(path, '/platform/support')) return 'support';
  if (under(path, '/platform/finance')) return 'finance';
  if (under(path, '/platform/admin')) return 'admin';
  return null;
}

export function PlatformSubTabs({ className }: { className?: string }) {
  const t = useTranslations('mobile.subTabs');
  const path = usePathname();
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path]);
  const section = sectionOf(path);
  if (!section) return null;
  return (
    <nav
      aria-label={t(`${section}.label`)}
      className={cn(
        'mx-1 -mt-1 flex flex-none gap-4.5 overflow-x-auto shadow-hairline-b no-scrollbar',
        className,
      )}
    >
      {TABS[section].map((tab) => {
        const on = tab.match(path);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            ref={on ? active : undefined}
            {...(on ? { 'aria-current': 'page' as const } : {})}
            className={cn(
              'flex min-h-11 flex-none items-end pt-1.5 pb-2.5 text-body font-semibold whitespace-nowrap no-underline',
              on ? 'text-fg-1 shadow-tab-active' : 'text-fg-2',
            )}
          >
            {t(`${section}.${tab.key}` as 'support.cases')}
          </Link>
        );
      })}
    </nav>
  );
}
