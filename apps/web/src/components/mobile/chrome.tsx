'use client';

import { cn } from '@agentor/ui';
import {
  Activity,
  CircleX,
  CreditCard,
  House,
  Kanban,
  Menu,
  Search,
  Users,
  Workflow,
} from 'lucide-react';
import {
  PlatformBadge,
  TabBar,
  TopBar,
  TopBarAction,
  TopBarAvatar,
  type TopBarProps,
} from '@agentor/ui/mobile';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { activeAppTab, activePlatformTab, platformHidesTabBar } from './tabs';

/**
 * Mobile chrome in the app (README decision 20). The layout knows the bell's count and the staff
 * role; pages render their own top bar (logo, or back + title), so the layout shares what it knows
 * through this context.
 */
interface Chrome {
  attention: { count: number; severe: boolean };
  user?: { name: string; initials: string };
  superadmin?: boolean;
}

const ChromeContext = createContext<Chrome>({ attention: { count: 0, severe: false } });

export function MobileChromeProvider({ value, children }: { value: Chrome; children: ReactNode }) {
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

type PageTopBarProps = Pick<TopBarProps, 'title' | 'subtitle' | 'actions' | 'className'> & {
  /** Back link; without it the bar shows the logo. */
  back?: string;
  /** MA11, MA12 have no bell. */
  bell?: boolean;
  /**
   * The layout's bar for pages without a mobile view of their own: hidden as soon as the page
   * renders its own top bar, and never above 768 px (issue 2, 20 Oct 2026).
   */
  fallback?: boolean;
};

const FALLBACK = 'md:hidden group-has-[[data-page-topbar]]/shell:hidden';

/** The customer app's top bar with the bell from the layout. */
export function AppTopBar({ back, bell = true, fallback = false, ...rest }: PageTopBarProps) {
  const t = useTranslations('mobile');
  const { attention } = useContext(ChromeContext);
  // Top-level screens get search (MA17) next to the bell; sub-screens bring their own actions.
  const actions =
    rest.actions ??
    (back ? undefined : (
      <TopBarAction icon={Search} label={t('search.title')} href="/search" linkAs={Link} />
    ));
  return (
    <TopBar
      {...rest}
      {...(actions ? { actions } : {})}
      linkAs={Link}
      pageLevel={!fallback}
      className={cn(fallback && FALLBACK, rest.className)}
      {...(back
        ? { back: { href: back, label: t('back') } }
        : { logo: { href: '/', label: t('home') } })}
      {...(bell
        ? {
            bell: {
              href: '/notifications',
              count: attention.count,
              severe: attention.severe,
              label: t('bell', { count: attention.count }),
            },
          }
        : {})}
    />
  );
}

/**
 * Platform's navy top bar: logotype + "Platform", the bell and the avatar; or back + title on a
 * case. Staff have no notification feed, so the bell counts their own open cases and opens them.
 */
export function PlatformTopBar({ back, bell = true, fallback = false, ...rest }: PageTopBarProps) {
  const t = useTranslations('mobile');
  const { user, attention } = useContext(ChromeContext);
  return (
    <TopBar
      {...rest}
      variant="platform"
      linkAs={Link}
      pageLevel={!fallback}
      className={cn(fallback && FALLBACK, rest.className)}
      {...(bell
        ? {
            bell: {
              href: '/platform/cases?filter=mine',
              count: attention.count,
              severe: attention.severe,
              label: t('platformBell', { count: attention.count }),
            },
          }
        : {})}
      {...(back
        ? { back: { href: back, label: t('back') } }
        : {
            logo: {
              href: '/platform/customers',
              label: t('platformBadge'),
              badge: <PlatformBadge>{t('platformBadge')}</PlatformBadge>,
            },
          })}
      actions={
        rest.actions ??
        (user ? (
          <TopBarAvatar initials={user.initials} label={t('profile', { name: user.name })} />
        ) : undefined)
      }
    />
  );
}

export function AppTabBar({ className }: { className?: string }) {
  const t = useTranslations('mobile.tabs');
  const path = usePathname();
  return (
    <TabBar
      label={t('label')}
      linkAs={Link}
      active={activeAppTab(path)}
      className={cn('md:hidden', className)}
      items={[
        { key: 'overview', href: '/', label: t('overview'), icon: House },
        { key: 'integrations', href: '/integrations', label: t('integrations'), icon: Workflow },
        { key: 'activity', href: '/activity', label: t('activity'), icon: Activity },
        { key: 'more', href: '/more', label: t('more'), icon: Menu },
      ]}
    />
  );
}

/** Kunder, Sager, Fejl, and Finans for Superadmin only (README decision 18). */
export function PlatformTabBar({ className }: { className?: string }) {
  const t = useTranslations('mobile.tabs');
  const path = usePathname();
  const { superadmin } = useContext(ChromeContext);
  if (platformHidesTabBar(path)) return null;
  return (
    <TabBar
      label={t('label')}
      linkAs={Link}
      variant="platform"
      active={activePlatformTab(path)}
      className={cn('md:hidden', className)}
      items={[
        { key: 'customers', href: '/platform/customers', label: t('customers'), icon: Users },
        { key: 'cases', href: '/platform/cases', label: t('cases'), icon: Kanban },
        { key: 'errors', href: '/platform/errors', label: t('errors'), icon: CircleX },
        ...(superadmin
          ? [{ key: 'finance', href: '/platform/finance', label: t('finance'), icon: CreditCard }]
          : []),
      ]}
    />
  );
}

/** Bottom padding for the fixed tab bar under the mobile layout; none on a case (timer bar). */
export function UnderTabBar({
  platform = false,
  children,
}: {
  platform?: boolean;
  children: ReactNode;
}) {
  const path = usePathname();
  const pad = !(platform && platformHidesTabBar(path));
  return (
    <div className={cn('flex flex-1 flex-col', pad && 'max-md:pb-under-tabbar')}>{children}</div>
  );
}
