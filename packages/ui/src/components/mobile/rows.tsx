import type { Status } from '@agentor/core';
import { ArrowRight, ChevronRight, Laptop, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import { StatusPill } from '../status';
import type { LinkAs } from './shell';

// Server-safe: no hooks.

/* ---- Card: white, radius 16, shadow-sm (".card" on the boards) ------------------------------------ */

export function MobileCard({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name when the card is a landmark of its own. */
  label?: string;
}) {
  return (
    <section
      className={cn('overflow-hidden rounded-md bg-surface shadow-sm', className)}
      {...(label ? { 'aria-label': label } : {})}
    >
      {children}
    </section>
  );
}

/* ---- SectionHeading: 12/700, uppercase, fg-1, 14 px top margin (".sec2") ------------------------- */

export function SectionHeading({
  children,
  as: As = 'h2',
  flush = false,
  className,
}: {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'span';
  /** No margins, for headings inside a card (MA06 "Hvorfor"). */
  flush?: boolean;
  className?: string;
}) {
  return (
    <As
      className={cn(
        'text-meta font-bold uppercase leading-snug tracking-section text-fg-1',
        flush ? 'm-0' : 'mx-1 mb-0 mt-3.5',
        className,
      )}
    >
      {children}
    </As>
  );
}

/* ---- Page heading: 26/700 title + 14 fg-2 subtitle (MA02, MA04) --------------------------------- */

export function MobilePageTitle({
  title,
  subtitle,
  aside,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned on the title's baseline (MP06 "Oktober 2026"). */
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-1 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-m-title">{title}</h1>
        {aside && <span className="text-meta font-medium text-fg-2">{aside}</span>}
      </div>
      {subtitle && <p className="m-0 text-body text-fg-2">{subtitle}</p>}
    </div>
  );
}

/* ---- RowIcon: tinted circle with a glyph (MA03, MA09, MA10, MA12) -------------------------------- */

export type RowTone = 'error' | 'warn' | 'ok' | 'info' | 'neutral' | 'lime' | 'dark';

const TONE: Record<RowTone, string> = {
  error: 'bg-error-bg text-error-fg',
  warn: 'bg-warn-bg text-warn-fg',
  ok: 'bg-ok-bg text-ok-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-paused-bg text-fg-1',
  lime: 'bg-primary text-fg-1',
  dark: 'bg-fg-1 text-white',
};

const ROW_ICON_SIZE = {
  28: { box: 'size-7', glyph: 14 },
  30: { box: 'size-7.5', glyph: 14 },
  32: { box: 'size-8', glyph: 16 },
  40: { box: 'size-10', glyph: 18 },
  52: { box: 'size-13', glyph: 24 },
} as const;

export function RowIcon({
  icon,
  tone = 'neutral',
  size = 32,
  label,
}: {
  icon: LucideIcon;
  tone?: RowTone;
  size?: keyof typeof ROW_ICON_SIZE;
  /** Only when the icon carries meaning that the text next to it doesn't. */
  label?: string;
}) {
  const s = ROW_ICON_SIZE[size];
  return (
    <span className={cn('grid flex-none place-items-center rounded-full', s.box, TONE[tone])}>
      <Icon
        icon={icon}
        size={s.glyph as 14 | 16 | 18 | 24}
        className={
          size === 40 ? 'size-5' : size === 52 ? 'size-6.5' : size === 30 ? 'size-3.75' : undefined
        }
        {...(label ? { label } : {})}
      />
    </span>
  );
}

/* ---- ConnectorLogo (mobile): 26/28 white tile, 18 px logo, 1 px ring (".lg"), initials fallback - */

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

const LOGO_SIZE = { 26: 'size-6.5', 28: 'size-7', 32: 'size-8' } as const;

export function MobileLogo({
  name,
  logoUrl,
  size = 28,
}: {
  name: string;
  logoUrl?: string | undefined;
  size?: keyof typeof LOGO_SIZE;
}) {
  return (
    <span
      className={cn(
        'grid flex-none place-items-center rounded-sm box-border font-semibold text-fg-1',
        logoUrl ? 'bg-white shadow-ring-border' : 'border border-border bg-bg-base text-micro',
        LOGO_SIZE[size],
      )}
    >
      {logoUrl ? (
        // Tiny static SVGs from docs/design/runde-1/logos; an optimised image adds nothing.
        <img src={logoUrl} alt={name} className="block size-4.5 object-contain" />
      ) : (
        <span role="img" aria-label={name}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}

export interface LogoRef {
  name: string;
  logoUrl?: string | undefined;
}

/** Source → destinations (MA04, MA05). */
export function LogoChain({
  source,
  destinations,
  size = 26,
}: {
  source: LogoRef;
  destinations: LogoRef[];
  size?: 26 | 28;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <MobileLogo name={source.name} logoUrl={source.logoUrl} size={size} />
      <Icon icon={ArrowRight} size={14} className="text-fg-3" />
      {destinations.map((d, i) => (
        <MobileLogo key={`${d.name}-${i}`} name={d.name} logoUrl={d.logoUrl} size={size} />
      ))}
    </span>
  );
}

/* ---- RowLink / Row: 56 px row, leading, title + meta, trailing (".row") ------------------------ */

export interface RowProps {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Pill, badge, button-looking span, switch or a stacked status; defaults to a chevron on links. */
  trailing?: ReactNode;
  className?: string;
}

function RowBody({ leading, title, meta }: Omit<RowProps, 'trailing' | 'className'>) {
  return (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col py-2.5 leading-snug">
        <strong className="truncate text-body font-semibold leading-snug">{title}</strong>
        {meta && <span className="truncate text-meta font-medium text-fg-2">{meta}</span>}
      </span>
    </>
  );
}

const ROW =
  'flex min-h-14 items-center gap-3 px-4 text-fg-1 no-underline shadow-row-divider last:shadow-none';

/** A row that opens something: the whole row is one link. */
export function RowLink({
  href,
  linkAs: L = 'a',
  trailing,
  className,
  ...body
}: RowProps & { href: string; linkAs?: LinkAs }) {
  return (
    <L href={href} className={cn(ROW, 'hover:bg-row-hover', className)}>
      <RowBody {...body} />
      {trailing ?? <Chevron />}
    </L>
  );
}

/** A row that only shows (route lists, settings with a switch as `trailing`). */
export function Row({ trailing, className, ...body }: RowProps) {
  return (
    <div className={cn(ROW, className)}>
      <RowBody {...body} />
      {trailing}
    </div>
  );
}

export function Chevron() {
  return (
    <span className="flex text-fg-2">
      <Icon icon={ChevronRight} size={18} />
    </span>
  );
}

/** Dot + status word over a small meta line, right-aligned (MA05 route rows). */
export function StackedStatus({
  status,
  label,
  meta,
}: {
  status: Status;
  label: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <span className="flex flex-none flex-col items-end gap-1">
      <StatusPill status={status} compact>
        {label}
      </StatusPill>
      {meta && <span className="text-micro font-medium text-fg-2">{meta}</span>}
    </span>
  );
}

/** Value over a pill, right-aligned (MP06 key figures). */
export function StackedValue({ value, pill }: { value: ReactNode; pill?: ReactNode }) {
  return (
    <span className="flex flex-none flex-col items-end gap-1">
      <strong className="text-card font-semibold tabular">{value}</strong>
      {pill}
    </span>
  );
}

/** Small dark action drawn inside a row link (MA03 "Genforbind"): part of the row's one target. */
export function RowAction({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 flex-none items-center rounded-full bg-navy px-3 text-meta font-semibold text-on-navy">
      {children}
    </span>
  );
}

/* ---- StatusHero: 40 px circle + 18/700 headline + meta, optional rows under it (MA02, MA03) ---- */

const HERO_ICON: Record<'ok' | 'error' | 'warn' | 'paused' | 'info', RowTone> = {
  ok: 'ok',
  error: 'error',
  warn: 'warn',
  paused: 'neutral',
  info: 'info',
};

export function StatusHero({
  tone,
  icon,
  headline,
  meta,
  children,
}: {
  tone: keyof typeof HERO_ICON;
  icon: LucideIcon;
  headline: ReactNode;
  meta?: ReactNode;
  /** Rows under the headline (MA03: one per problem). */
  children?: ReactNode;
}) {
  return (
    <MobileCard>
      <div className={cn('flex items-center gap-3 px-4', children ? 'pb-3 pt-4' : 'py-3.5')}>
        <RowIcon icon={icon} tone={HERO_ICON[tone]} size={40} />
        <div className="flex flex-col leading-snug">
          <strong className="text-m-hero">{headline}</strong>
          {meta && <span className="text-meta font-medium text-fg-2">{meta}</span>}
        </div>
      </div>
      {children}
    </MobileCard>
  );
}

/* ---- FlowCard: logos source → destinations, status pill, name 15/600, meta (MA04) -------------- */

export function FlowCard({
  href,
  linkAs: L = 'a',
  source,
  destinations,
  status,
  statusLabel,
  name,
  meta,
}: {
  href: string;
  linkAs?: LinkAs;
  source: LogoRef;
  destinations: LogoRef[];
  status: Status;
  statusLabel: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <L
      href={href}
      className="flex flex-col gap-2 rounded-md bg-surface px-4 py-3.5 text-fg-1 no-underline shadow-sm"
    >
      <span className="flex items-center justify-between gap-2">
        <LogoChain source={source} destinations={destinations} />
        <StatusPill status={status}>{statusLabel}</StatusPill>
      </span>
      <strong className="text-nav font-semibold">{name}</strong>
      {meta && <span className="text-meta font-medium text-fg-2">{meta}</span>}
    </L>
  );
}

/* ---- DeskNote: the grey "computer" line, optional action (decision 20) ------------------------- */

export function DeskNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-node bg-paused-bg px-3.5 py-2.5 text-m-note text-fg-1">
      <Icon icon={Laptop} size={18} />
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

/** Small grey explanation under a card (MA11, MA12). */
export function MobileFootnote({ children }: { children: ReactNode }) {
  return <p className="mx-1 my-0 text-meta font-medium text-fg-2">{children}</p>;
}
