'use client';

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  cn,
} from '@agentor/ui';
import { ChevronDown, LogOut, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { authClient } from '@/lib/auth-client';
import { Logo } from '../logo';
import { GearMenu, type GearCounts } from './gear-menu';

export interface PlatformUser {
  name: string;
  email: string;
  role: 'superadmin' | 'supporter';
}

/**
 * Platform header (P1): navy bar with the Platform badge, the Platform sections, search, the
 * gear menu and the staff member's chip. Platformbrugere is only shown to Superadmin.
 */
export function PlatformHeader({ user, counts }: { user: PlatformUser; counts: GearCounts }) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [q, setQ] = useState('');
  const items = [
    { href: '/platform/customers', key: 'customers' },
    { href: '/platform/cases', key: 'cases' },
    { href: '/platform/errors', key: 'errors' },
    { href: '/platform/time', key: 'time' },
    { href: '/platform/status', key: 'status' },
    ...(user.role === 'superadmin' ? [{ href: '/platform/users', key: 'users' }] : []),
  ] as const;
  return (
    <header className="on-navy flex-none bg-navy px-gutter text-on-navy">
      <div className="mx-auto flex h-18 max-w-content items-center gap-10">
        <Link
          href="/platform/customers"
          aria-label={t('home')}
          className="flex flex-none items-center gap-2.5 text-on-navy no-underline"
        >
          <Logo />
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-micro font-semibold text-fg-1">
            {t('badge')}
          </span>
        </Link>
        <nav aria-label={t('nav')} className="flex min-w-0 flex-1 items-center gap-7 overflow-x-auto">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-2.5 text-on-navy" />
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('account', { name: user.name })}
                className="ml-1 flex h-10 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-on-navy/10 pl-1 pr-2.5 font-sans text-on-navy"
              >
                <Avatar name={user.name} size={32} />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-table font-semibold">{user.name}</span>
                  <span className="text-micro font-medium text-on-navy-muted">
                    {t(`role.${user.role}`)} · Agentor
                  </span>
                </span>
                <Icon icon={ChevronDown} size={16} className="text-on-navy-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Icon icon={LogOut} size={16} />}
                onSelect={() =>
                  start(async () => {
                    await authClient.signOut();
                    router.replace('/login');
                    router.refresh();
                  })
                }
              >
                {t('logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
