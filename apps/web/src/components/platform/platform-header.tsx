'use client';

import { Avatar, Icon, cn } from '@agentor/ui';
import { ChevronRight, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '../logo';
import { GearMenu, type GearCounts } from './gear-menu';

export interface PlatformUser {
  name: string;
  email: string;
  role: 'superadmin' | 'supporter';
}

/**
 * Platform header (P1, README decision 24): navy bar with the Platform badge, Kunder · Support ·
 * Finans · Administration (the last two for Superadmin only), search, the gear menu and the
 * profile button, which opens the profile dashboard (PR1).
 */
export function PlatformHeader({ user, counts }: { user: PlatformUser; counts: GearCounts }) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  // README decision 24: a Supporter sees Kunder and Support; Superadmin also Finans and
  // Administration (the server answers 404 there for anyone else).
  const items = [
    { href: '/platform/customers', match: '/platform/customers', key: 'customers' },
    { href: '/platform/support/cases', match: '/platform/support', key: 'support' },
    ...(user.role === 'superadmin'
      ? [
          { href: '/platform/finance', match: '/platform/finance', key: 'finance' },
          { href: '/platform/admin/status', match: '/platform/admin', key: 'admin' },
        ]
      : []),
  ] as const;
  return (
    <header className="on-navy flex-none bg-navy px-gutter text-on-navy">
      <div className="mx-auto flex h-18 max-w-content items-center gap-10">
        <Link
          href="/platform/customers"
          aria-label={t('home')}
          className="flex flex-none items-center gap-2.5 text-on-navy no-underline"
        >
          <Logo size="platform" className="text-on-navy" />
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-micro font-semibold text-fg-1">
            {t('badge')}
          </span>
        </Link>
        <nav
          aria-label={t('nav')}
          className="flex min-w-0 flex-1 items-center gap-7 overflow-x-auto"
        >
          {items.map((item) => {
            const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap py-1 text-nav font-medium text-on-navy-muted no-underline hover:text-on-navy',
                  active && 'font-semibold text-on-navy shadow-tab-active-light',
                )}
              >
                {t(`section.${item.key}`)}
              </Link>
            );
          })}
        </nav>
        <form
          role="search"
          className="hidden items-center lg:flex"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/platform/customers?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <label className="relative flex items-center">
            <span className="sr-only">{t('search')}</span>
            <Icon
              icon={Search}
              size={18}
              className="pointer-events-none absolute left-2.5 text-on-navy"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              className="h-9 w-9 rounded-full border-0 bg-transparent pl-9 font-sans text-table text-on-navy outline-none transition-all placeholder:text-transparent focus:w-56 focus:bg-on-navy/10 focus:placeholder:text-on-navy-muted"
            />
          </label>
        </form>
        <div className="flex flex-none items-center gap-2">
          <GearMenu role={user.role} counts={counts} />
          <Link
            href="/platform/profile"
            aria-label={t('account')}
            aria-current={pathname === '/platform/profile' ? 'page' : undefined}
            className="ml-1 flex h-10 items-center gap-2.5 rounded-full bg-on-navy/10 pl-1 pr-2.5 font-sans text-on-navy no-underline hover:bg-on-navy/15"
          >
            <Avatar name={user.name} size={32} />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-table font-semibold">{user.name}</span>
              <span className="text-micro font-medium text-on-navy-muted">
                {t(`role.${user.role}`)} · Agentor
              </span>
            </span>
            <Icon icon={ChevronRight} size={16} className="text-on-navy-muted" />
          </Link>
        </div>
      </div>
    </header>
  );
}
