import { ArrowLeft, Bell, type LucideIcon } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';

// Server-safe: no hooks. Links render through `linkAs` (next/link in the app, <a> by default).

export type LinkAs = ElementType;

/* ---- Responsive: one route, two layouts, switched at 768 px (PLAN-MOBILE §1) --------------------- */

/**
 * Renders the mobile branch below 768 px and the desktop branch from 768 px. The hidden branch is
 * `display: none`, so it is out of the tab order and the accessibility tree.
 */
export function Responsive({ mobile, desktop }: { mobile: ReactNode; desktop: ReactNode }) {
  return (
    <>
      <div className="contents max-md:hidden" data-view="desktop">
        {desktop}
      </div>
      <div className="contents md:hidden" data-view="mobile">
        {mobile}
      </div>
    </>
  );
}

/* ---- MobileShell: top bar 60 + content + tab bar 76 (MA02) --------------------------------------- */

export interface MobileShellProps {
  topBar?: ReactNode;
  /** Offline banner and similar, under the top bar. */
  banner?: ReactNode;
  children: ReactNode;
  /** The fixed tab bar. In the app it comes from the layout, so pages leave it out. */
  tabBar?: ReactNode;
  /** A fixed 52 px action bar instead of the tab bar (MP03 timer). */
  bottomBar?: ReactNode;
  /** Id for the skip link (the desktop branch owns `main`). */
  mainId?: string;
  className?: string;
}

export function MobileShell({
  topBar,
  banner,
  children,
  tabBar,
  bottomBar,
  mainId = 'main-mobile',
  className,
}: MobileShellProps) {
  return (
    // Fills what the layout leaves: in the app the layout already reserves the tab bar's height.
    <div className={cn('flex flex-1 flex-col bg-canvas', className)}>
      {topBar}
      {banner}
      <main
        id={mainId}
        tabIndex={-1}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3 outline-none',
          bottomBar ? 'pb-under-bar' : 'pb-4',
          tabBar && 'pb-under-tabbar',
        )}
      >
        {children}
      </main>
      {bottomBar}
      {tabBar}
    </div>
  );
}

/* ---- TopBar: logo, or back + title + subtitle; bell with badge; navy Platform variant ------------- */

export interface BellProps {
  href: string;
  /** "Kræver handling" count (README decision 4). 0 hides the badge. */
  count: number;
  /** Red badge for errors and broken connections, dark otherwise. */
  severe: boolean;
  /** "Notifikationer, 2 nye". */
  label: string;
}

export interface TopBarProps {
  variant?: 'app' | 'platform';
  /** With a back link the bar shows title + subtitle instead of the logo. */
  back?: { href: string; label: string };
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Accessible name of the logo link, e.g. "Agentor, gå til Overblik". */
  logo?: { href: string; label: string; badge?: ReactNode };
  bell?: BellProps;
  /** Trailing actions instead of or before the bell (MP03 "Registrér tid", MP01 avatar). */
  actions?: ReactNode;
  linkAs?: LinkAs;
  className?: string;
}

/** Wordmark "Agent" + "or" with a 2 px underline under "or" (README decision 5), 20/700 on mobile. */
export function MobileWordmark({ onNavy = false }: { onNavy?: boolean }) {
  return (
    <span className={cn('text-m-logo', onNavy ? 'text-on-navy' : 'text-fg-1')} aria-hidden>
      Agent
      <span className={cn('border-b-2 pb-px', onNavy ? 'border-on-navy' : 'border-fg-1')}>or</span>
    </span>
  );
}

const ICON_BUTTON =
  'relative grid size-11 flex-none place-items-center rounded-full border-0 bg-transparent no-underline';

export function TopBar({
  variant = 'app',
  back,
  title,
  subtitle,
  logo,
  bell,
  actions,
  linkAs: L = 'a',
  className,
}: TopBarProps) {
  const navy = variant === 'platform';
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex-none pt-safe',
        navy ? 'on-navy bg-navy text-on-navy' : 'bg-canvas text-fg-1',
        className,
      )}
    >
      <div className="flex h-15 items-center gap-2 px-4">
        {back ? (
          <>
            <L
              href={back.href}
              className={cn(ICON_BUTTON, '-ml-2.5', navy ? 'text-on-navy' : 'text-fg-1')}
            >
              <Icon icon={ArrowLeft} size={18} className="size-5" label={back.label} />
            </L>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              {title && <h1 className="m-0 truncate text-card">{title}</h1>}
              {subtitle && (
                <span
                  className={cn('truncate text-meta', navy ? 'text-on-navy-muted' : 'text-fg-2')}
                >
                  {subtitle}
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="flex flex-1 items-center gap-2">
            {logo ? (
              <L href={logo.href} className="flex h-11 items-center rounded-sm no-underline">
                <span className="sr-only">{logo.label}</span>
                <MobileWordmark onNavy={navy} />
              </L>
            ) : (
              <MobileWordmark onNavy={navy} />
            )}
            {logo?.badge}
          </span>
        )}
        {actions}
        {bell && <BellLink {...bell} linkAs={L} onNavy={navy} />}
      </div>
    </header>
  );
}

export function BellLink({
  href,
  count,
  severe,
  label,
  linkAs: L = 'a',
  onNavy = false,
}: BellProps & { linkAs?: LinkAs; onNavy?: boolean }) {
  return (
    <L href={href} className={cn(ICON_BUTTON, onNavy ? 'text-on-navy' : 'text-fg-1')}>
      <Icon icon={Bell} size={18} className="size-5" label={label} />
      {count > 0 && (
        <span
          aria-hidden
          className={cn(
            'absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full px-1 text-nano font-bold text-white box-border',
            severe ? 'bg-error-fg' : 'bg-fg-1',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </L>
  );
}

/** 44 px round icon action for the top bar (MP03 "Registrér tid"). */
export function TopBarAction({
  icon,
  label,
  href,
  onClick,
  linkAs: L = 'a',
  onNavy = false,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  linkAs?: LinkAs;
  onNavy?: boolean;
}) {
  const cls = cn(ICON_BUTTON, 'cursor-pointer', onNavy ? 'text-on-navy' : 'text-fg-1');
  const glyph = <Icon icon={icon} size={18} className="size-5" label={label} />;
  if (href)
    return (
      <L href={href} className={cls}>
        {glyph}
      </L>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {glyph}
    </button>
  );
}

/** "Platform" badge next to the wordmark (MP01). */
export function PlatformBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-primary px-2.25 text-micro font-semibold text-fg-1">
      {children}
    </span>
  );
}

/** Initials on white in the navy bar (MP01). Not interactive until Platform "Mere" exists (G7). */
export function TopBarAvatar({ initials, label }: { initials: string; label: string }) {
  return (
    <span className="grid size-11 flex-none place-items-center">
      <span
        role="img"
        aria-label={label}
        className="grid size-8 place-items-center rounded-full bg-white text-micro font-semibold text-navy"
      >
        {initials}
      </span>
    </span>
  );
}

/* ---- TabBar: 4 tabs, active = lime pill behind the icon (navy pill on Platform) ------------------- */

export interface TabItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

export function TabBar({
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
  variant?: 'app' | 'platform';
  linkAs?: LinkAs;
  /** Fixed to the bottom of the viewport (the app); static in previews. */
  fixed?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'z-30 flex h-tabbar-safe flex-none bg-white pb-tabbar-safe shadow-tabbar box-border',
        fixed && 'fixed inset-x-0 bottom-0',
        className,
      )}
    >
      {items.map((t) => {
        const on = t.key === active;
        return (
          <L
            key={t.key}
            href={t.href}
            {...(on ? { 'aria-current': 'page' } : {})}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-0.75 pt-2 text-micro font-semibold no-underline',
              on ? 'text-fg-1' : 'text-fg-2',
            )}
          >
            <span
              className={cn(
                'grid h-7.5 w-13 place-items-center rounded-full',
                on && (variant === 'platform' ? 'bg-navy text-on-navy' : 'bg-primary'),
              )}
            >
              <Icon icon={t.icon} size={18} className="size-5" />
            </span>
            <span className="max-w-full truncate px-1">{t.label}</span>
          </L>
        );
      })}
    </nav>
  );
}
