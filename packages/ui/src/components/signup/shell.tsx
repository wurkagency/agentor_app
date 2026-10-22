import { KeyRound, MapPin, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Logotype } from '../logotype';
import { Icon } from '../icon';

// Server-safe: no hooks. Signup and onboarding (README decisions 21–22, SU/OB and MS/MO boards).

/* ---- Wordmark ------------------------------------------------------------------------------------- */

/** The Agentor logotype (21 Oct 2026, replaces the text wordmark): 22 px on SU/OB, 20 px on MS/MO. */
export function SignupLogo({ mobile = false }: { mobile?: boolean }) {
  return <Logotype label="Agentor" className={cn('text-fg-1', mobile ? 'h-5' : 'h-5.5')} />;
}

/* ---- SignupShell (desktop, from 768 px) --------------------------------------------------------- */

export interface SignupShellProps {
  /** "Har du allerede en konto? Log ind" or "Spring over og gå til overblik". */
  topRight?: ReactNode | undefined;
  /** StepProgress variant="top", inside the form column above the heading. */
  step?: ReactNode | undefined;
  children: ReactNode;
  /** The navy TrustPanel on the right. Without it the form column is centred alone (SU6, OB5). */
  panel?: ReactNode | undefined;
  /** OB3/OB4: the form column takes 1.25fr and up to 680 px (template cards, test run table). */
  wide?: boolean | undefined;
  /** OB1–OB4 start at the top; signup steps are centred. */
  alignTop?: boolean | undefined;
  mainId?: string | undefined;
}

export function SignupShell({
  topRight,
  step,
  children,
  panel,
  wide = false,
  alignTop = false,
  mainId = 'main',
}: SignupShellProps) {
  return (
    <div
      className={cn(
        'min-h-dvh bg-canvas',
        panel && (wide ? 'grid grid-cols-signup-wide' : 'grid grid-cols-signup'),
      )}
    >
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-18 flex-none items-center justify-between gap-6 px-signup-header">
          <SignupLogo />
          {topRight && <span className="text-table text-fg-2">{topRight}</span>}
        </header>
        <main
          id={mainId}
          className={cn(
            'flex flex-1 justify-center px-signup pt-6 pb-12',
            alignTop ? 'items-start' : 'items-center',
          )}
        >
          <div
            className={cn(
              'flex w-full flex-col gap-5',
              wide ? 'max-w-signup-wide' : 'max-w-signup',
            )}
          >
            {step}
            {children}
          </div>
        </main>
      </div>
      {panel}
    </div>
  );
}

/* ---- MobileSignupShell (below 768 px, 390 × 844 boards) ---------------------------------------- */

export interface MobileSignupShellProps {
  topRight?: ReactNode | undefined;
  children: ReactNode;
  /** Pushed to the bottom above the step indicator (MS2's navy plan, MO5's install card). */
  footer?: ReactNode | undefined;
  /** StepProgress variant="bottom": under the main button, at the bottom of the screen. */
  step?: ReactNode | undefined;
  mainId?: string | undefined;
}

export function MobileSignupShell({
  topRight,
  children,
  footer,
  step,
  mainId = 'main-mobile',
}: MobileSignupShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-14 flex-none items-center justify-between gap-3 px-5">
        <SignupLogo mobile />
        {topRight && <span className="text-table text-fg-2">{topRight}</span>}
      </header>
      <main id={mainId} className="flex flex-1 flex-col gap-3 px-5 pt-1 pb-5">
        {children}
        {(footer || step) && (
          <div className="mt-auto flex flex-col gap-3 pt-1">
            {footer}
            {step}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * The first heading on every MS/MO screen has 40 px above it; when something sits above the
 * heading (MO2's banner, MO5's live card), that element gets the 40 px instead (layout review).
 */
export function SignupHeading({
  title,
  lead,
  mobile = false,
  offsetTop = mobile,
  icon,
}: {
  title: ReactNode;
  lead?: ReactNode | undefined;
  mobile?: boolean | undefined;
  /** 40 px above the heading on mobile; off when an element above it takes the space. */
  offsetTop?: boolean | undefined;
  /** SU2's lime mail tile above the heading. */
  icon?: ReactNode | undefined;
}) {
  return (
    <>
      {icon}
      <div className={cn('flex flex-col', mobile ? 'gap-1.5' : 'gap-2')}>
        <h1
          className={cn(
            'm-0',
            mobile ? 'text-m-title' : 'text-su-title',
            mobile && offsetTop && 'pt-10',
          )}
        >
          {title}
        </h1>
        {lead && (
          <p className={cn('m-0 text-fg-2', mobile ? 'text-m-lead' : 'text-su-lead')}>{lead}</p>
        )}
      </div>
    </>
  );
}

/* ---- StepProgress ------------------------------------------------------------------------------------ */

export interface StepProgressProps {
  variant: 'top' | 'bottom';
  /** 1-based. */
  current: number;
  /** "Konto", "Virksomhed", … (desktop shows all four under the bars). */
  labels: string[];
  /** "Trin 2 af 4" / "Opsætning 2 af 4". */
  counter: string;
  /** "Næste: Abonnement" or "Sidste trin". */
  next?: string | undefined;
  /** aria-label: "Trin 2 af 4" (desktop) or "Trin 2 af 4: Virksomhed" (mobile). */
  label: string;
}

/**
 * Desktop: inside the form column above the heading, four equal 6 px bars with the step names.
 * Mobile: at the bottom under the main button, thin 3 px bars and small grey text (review).
 */
export function StepProgress({
  variant,
  current,
  labels,
  counter,
  next,
  label,
}: StepProgressProps) {
  // Done steps dark, the current one lime, upcoming grey (SU3, MS3).
  const bar = (i: number) =>
    i < current - 1 ? 'bg-fg-1' : i === current - 1 ? 'bg-primary' : 'bg-border';
  const name = (i: number) =>
    i === current - 1
      ? 'font-bold text-fg-1'
      : i < current - 1
        ? 'font-medium text-fg-1'
        : 'font-medium text-fg-2';
  if (variant === 'bottom')
    return (
      <nav aria-label={label} className="flex flex-col gap-1.5 pt-1">
        <div className="flex gap-1">
          {labels.map((l, i) => (
            <span key={l} className={cn('h-0.75 flex-1 rounded-full', bar(i))} />
          ))}
        </div>
        <div className="flex justify-between text-m-caption font-medium text-fg-2">
          <span>
            {counter} · {labels[current - 1]}
          </span>
          {next && <span>{next}</span>}
        </div>
      </nav>
    );
  return (
    <nav aria-label={label} className="flex flex-col gap-2.5 pb-1">
      <div className="flex justify-between text-meta font-semibold">
        <span>{counter}</span>
        {next && <span className="font-medium text-fg-2">{next}</span>}
      </div>
      <ol className="m-0 flex list-none gap-2 p-0">
        {labels.map((l, i) => (
          <li
            key={l}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
            aria-current={i === current - 1 ? 'step' : undefined}
          >
            <span className={cn('h-1.5 rounded-full', bar(i))} />
            <span className={cn('truncate text-meta', name(i))}>{l}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ---- TrustPanel (desktop) and TrustRow (mobile) ------------------------------------------------- */

export function TrustPanel({
  title,
  lead,
  children,
  points,
  label,
}: {
  title: ReactNode;
  lead?: ReactNode | undefined;
  children?: ReactNode | undefined;
  /** TrustPoints at the bottom. */
  points: ReactNode;
  /** aria-label of the complementary region. */
  label: string;
}) {
  return (
    <aside
      aria-label={label}
      className="relative flex flex-col justify-center gap-8 overflow-hidden bg-navy py-14 text-on-navy px-signup-panel"
    >
      <div className="flex flex-col gap-2.5">
        <h2 className="m-0 max-w-signup-panel text-su-panel">{title}</h2>
        {lead && <p className="m-0 max-w-signup-panel text-su-lead text-on-navy-muted">{lead}</p>}
      </div>
      {children}
      {points}
    </aside>
  );
}

export interface TrustPoint {
  key: 'eu' | 'keys' | 'test';
  label: string;
}

const POINT_ICON: Record<TrustPoint['key'], LucideIcon> = {
  eu: MapPin,
  keys: KeyRound,
  test: ShieldCheck,
};

/** The three trust points: "Data i EU", "Krypterede nøgler", "Test før noget skrives". */
export function TrustPoints({ points, onNavy = true }: { points: TrustPoint[]; onNavy?: boolean }) {
  return (
    <ul
      className={cn(
        'm-0 flex list-none flex-wrap p-0',
        onNavy
          ? 'gap-5 text-table text-on-navy-strong'
          : 'justify-center gap-3.5 text-m-caption text-fg-2',
      )}
    >
      {points.map((p) => (
        <li key={p.key} className={cn('inline-flex items-center', onNavy ? 'gap-2' : 'gap-1.25')}>
          <Icon
            icon={POINT_ICON[p.key]}
            size={onNavy ? 16 : 14}
            className={onNavy ? 'text-primary' : ''}
          />
          {p.label}
        </li>
      ))}
    </ul>
  );
}

/** Mobile: the trust panel becomes this short line (decision 22). */
export function TrustRow({ points }: { points: TrustPoint[] }) {
  return <TrustPoints points={points} onNavy={false} />;
}

export interface LogoRef {
  name: string;
  logoUrl?: string | undefined;
}

/** Logo wall on the navy panel (SU1): 56 px white tiles, four per row. */
export function TrustLogoWall({ logos }: { logos: LogoRef[] }) {
  return (
    <ul className="m-0 grid list-none gap-3.5 p-0 grid-cols-logo-wall">
      {logos.map((l) => (
        <li
          key={l.name}
          className="grid size-14 place-items-center rounded-bubble bg-white shadow-tile"
        >
          <LogoImg logo={l} size="md" />
        </li>
      ))}
    </ul>
  );
}

/** Mobile logo row (MS1): 34 px tiles and "+N". */
export function LogoRow({ logos, more }: { logos: LogoRef[]; more?: string | undefined }) {
  return (
    <div className="mt-3 mb-4 flex items-center gap-2">
      {logos.map((l) => (
        <span
          key={l.name}
          className="grid size-8.5 flex-none place-items-center rounded-sm bg-white shadow-tile-m"
        >
          <LogoImg logo={l} size="sm" />
        </span>
      ))}
      {more && <span className="ml-0.5 text-meta font-medium text-fg-2">{more}</span>}
    </div>
  );
}

export function LogoImg({
  logo,
  size,
  decorative = false,
}: {
  logo: LogoRef;
  size: 'sm' | 'md' | 'lg';
  /** Next to the name in text: the logo adds nothing for assistive tech. */
  decorative?: boolean | undefined;
}) {
  const cls = { sm: 'size-5.5', md: 'size-7.5', lg: 'size-9.5' }[size];
  if (logo.logoUrl)
    // Tiny static SVGs from the catalogue.
    return (
      <img
        src={logo.logoUrl}
        alt={decorative ? '' : logo.name}
        className={cn('block object-contain', cls)}
      />
    );
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': logo.name })}
      className="text-meta font-semibold text-fg-1"
    >
      {logo.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * Example activity on SU1's panel. These are examples, not live data or customers (README
 * decision 21: no invented numbers), so the list is labelled as such.
 */
export function TrustExamples({
  label,
  items,
}: {
  label: string;
  items: { logo: LogoRef; title: string; meta: string }[];
}) {
  return (
    <div className="flex max-w-signup-panel flex-col gap-2.5">
      <p className="m-0 eyebrow text-on-navy-soft">{label}</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((it) => (
          <li
            key={it.title}
            className="flex items-center gap-3 rounded-bubble bg-white-7 px-3.5 py-3"
          >
            <span className="grid size-9 flex-none place-items-center rounded-sm bg-white shadow-tile">
              <LogoImg logo={it.logo} size="sm" />
            </span>
            <span className="flex min-w-0 flex-col leading-snug">
              <strong className="text-body">{it.title}</strong>
              <span className="text-meta text-on-navy-soft">{it.meta}</span>
            </span>
            <span aria-hidden className="ml-auto size-2 rounded-full bg-primary shadow-live-dot" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** SU2's numbered plan of the next steps (navy panel; small navy card on mobile). */
export function StepPlan({
  items,
  mobile = false,
}: {
  items: { title: string; text: string }[];
  mobile?: boolean | undefined;
}) {
  return (
    <ol
      className={cn(
        'm-0 flex list-none flex-col p-0',
        mobile ? 'gap-3' : 'max-w-signup-panel gap-3.5',
      )}
    >
      {items.map((it, i) => (
        <li key={it.title} className={cn('flex items-center', mobile ? 'gap-3' : 'gap-3.5')}>
          <span
            className={cn(
              'grid flex-none place-items-center rounded-full font-bold',
              mobile ? 'size-6.5 text-meta' : 'size-8 text-table',
              i === 0 ? 'bg-primary text-fg-1' : 'bg-white-14 text-on-navy',
            )}
          >
            {i + 1}
          </span>
          <span className="flex flex-col leading-snug">
            <strong className={mobile ? 'text-m-chat' : 'text-su-input'}>{it.title}</strong>
            <span className={cn('text-on-navy-soft', mobile ? 'text-meta' : 'text-table')}>
              {it.text}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Small navy card used on mobile in place of the panel (MS2, MO diagram). */
export function NavyCard({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md bg-navy p-4 text-on-navy">
      {title && <strong className="text-su-input">{title}</strong>}
      {children}
    </section>
  );
}
