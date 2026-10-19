'use client';

import { Avatar, Icon, cn } from '@agentor/ui';
import { Bell, ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '../logo';
import { CommandPalette, type PaletteEntities } from './command-palette';
import { NotificationsPopover, type NotificationItem } from './notifications-popover';
import { ProfileMenu, type ProfileMenuProps } from './profile-menu';

const PRIMARY = [
  { href: '/', key: 'overview', match: (p: string) => p === '/' },
  {
    href: '/integrations',
    key: 'integrations',
    match: (p: string) => p.startsWith('/integrations'),
  },
  { href: '/connections', key: 'connections', match: (p: string) => p.startsWith('/connections') },
  { href: '/activity', key: 'activity', match: (p: string) => p.startsWith('/activity') },
] as const;

export interface AppHeaderProps extends ProfileMenuProps {
  /** Items that need action; red badge when any of them is an error or broken connection. */
  attention: { count: number; severe: boolean };
  notifications: NotificationItem[];
  /** Flows and connections for ⌘K (D1-Søg). */
  search: PaletteEntities;
}

/**
 * App shell header (App-skal-B, README decision 1): 88 px, logo, primary text navigation with a
 * 2 px dark underline, then ⌘K, the bell and the account chip. No sidebar, no help icon.
 */
export function AppHeader({ attention, notifications, search, ...profile }: AppHeaderProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <header className="flex-none px-4 md:px-10">
      <div className="mx-auto flex h-header max-w-content items-center gap-14">
        <Link href="/" aria-label={t('home')} className="flex-none text-fg-1 no-underline">
          <Logo />
        </Link>
        <nav aria-label={t('primary')} className="flex min-w-0 flex-1 items-center gap-9">
          {PRIMARY.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap py-1 text-nav font-medium text-fg-2 no-underline hover:text-fg-1',
                  active && 'font-semibold text-fg-1 shadow-tab-active',
                )}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-none items-center gap-1">
          <CommandPalette
            entities={search}
            trigger={
              <button
                type="button"
                aria-label={t('search')}
                className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1 hover:bg-surface"
              >
                <Icon icon={Search} size={18} />
              </button>
            }
          />
          <NotificationsPopover
            items={notifications}
            trigger={
              <button
                type="button"
                aria-label={
                  attention.count > 0
                    ? t('notificationsCount', { count: attention.count })
                    : t('notifications')
                }
                className="relative grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1 hover:bg-surface"
              >
                <Icon icon={Bell} size={18} />
                {attention.count > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute right-0.5 top-0.75 box-border grid h-4 min-w-4 place-items-center rounded-full px-1 text-nano font-bold text-white shadow-cutout-canvas',
                      attention.severe ? 'bg-error-fg' : 'bg-fg-1',
                    )}
                  >
                    {attention.count}
                  </span>
                )}
              </button>
            }
          />
          <ProfileMenu
            {...profile}
            trigger={
              <button
                type="button"
                aria-label={t('account', { user: profile.user.name, tenant: profile.tenant.name })}
                className="ml-2 flex h-10 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-surface pl-1 pr-2.5 font-sans shadow-sm"
              >
                <Avatar name={profile.user.name} size={32} tone="navy" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-table font-semibold text-fg-1">
                    {profile.tenant.shortName}
                  </span>
                  <span className="text-micro font-medium text-fg-2">{profile.user.name}</span>
                </span>
                <Icon icon={ChevronDown} size={16} className="text-fg-2" />
              </button>
            }
          />
        </div>
      </div>
    </header>
  );
}
