import {
  BookOpen,
  CalendarCheck,
  Database,
  Flame,
  Globe,
  Heart,
  Mail,
  Rocket,
  Scale,
  ShieldCheck,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

/**
 * Profile dashboard building blocks (README decision 25: PR1, D15, MP29, MA36). One set for staff
 * and customers; the pages pass the role's data. Presentational only.
 */

const MEDAL_ICONS: Record<string, LucideIcon> = {
  trophy: Trophy,
  zap: Zap,
  heart: Heart,
  'book-open': BookOpen,
  'calendar-check': CalendarCheck,
  users: Users,
  rocket: Rocket,
  database: Database,
  scale: Scale,
  'shield-check': ShieldCheck,
};

const CHIP_ICONS = { mail: Mail, shield: ShieldCheck, globe: Globe } as const;

/**
 * The navy hero: avatar, eyebrow, name, contact chips, actions and four key figures. No glow
 * (decision 25). On the phone it runs edge to edge with a rounded bottom (MP29, MA36).
 */
export function ProfileHero({
  avatar,
  eyebrow,
  name,
  chips,
  actions,
  since,
  stats,
  mobile = false,
}: {
  avatar: ReactNode;
  eyebrow: string;
  name: string;
  chips: { icon: keyof typeof CHIP_ICONS; text: string }[];
  actions?: ReactNode;
  since: string;
  stats: { value: string; label: string }[];
  mobile?: boolean;
}) {
  return (
    <section
      aria-label={name}
      className={cn(
        'on-navy bg-navy text-on-navy',
        mobile
          ? '-mx-4 -mt-3 rounded-b-xl px-5 pb-4.5 pt-5'
          : 'rounded-hero px-9 py-8 shadow-profile-hero',
      )}
    >
      <div className={cn('flex items-center', mobile ? 'gap-4' : 'gap-7')}>
        {avatar}
        <div className={cn('flex min-w-0 flex-1 flex-col', mobile ? 'gap-1' : 'gap-2.5')}>
          <span className="text-micro font-semibold uppercase tracking-eyebrow text-primary">
            {eyebrow}
          </span>
          <h1
            className={cn(
              'm-0 font-bold tracking-tight',
              mobile ? 'text-section' : 'text-profile-name',
            )}
          >
            {name}
          </h1>
          {mobile ? (
            <span className="truncate text-meta text-on-navy-muted">{chips[0]?.text}</span>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {chips.map((c) => (
                <li
                  key={c.icon}
                  className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-white-10 px-3 text-meta font-semibold"
                >
                  <Icon icon={CHIP_ICONS[c.icon]} size={14} />
                  {c.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        {!mobile && (
          <div className="flex flex-col items-end gap-2 self-start">
            {actions}
            <span className="text-meta text-on-navy-soft">{since}</span>
          </div>
        )}
      </div>
      <dl className={cn('m-0 grid', mobile ? 'mt-4 grid-cols-2 gap-2' : 'mt-7 grid-cols-4 gap-3')}>
        {stats.map((s) => (
          <div
            key={s.label}
            className={cn(
              'flex min-w-0 flex-col-reverse gap-0.5 shadow-stat-line',
              mobile
                ? 'rounded-bubble bg-white-8 px-3 py-2.5'
                : 'rounded-md bg-white-7 px-4.5 py-3.5',
            )}
          >
            <dt className="truncate text-meta text-on-navy-soft">{s.label}</dt>
            <dd
              className={cn(
                'm-0 font-bold tabular-nums tracking-tight',
                mobile ? 'text-section' : 'text-profile-stat',
              )}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A card on the profile: title, optional meta or action on the right. */
export function ProfileCard({
  id,
  title,
  meta,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        'flex min-w-0 scroll-mt-24 flex-col gap-4 rounded-lg bg-surface px-6 py-5.5 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={id ? `${id}-title` : undefined}
          className="m-0 text-profile-card font-bold tracking-tight"
        >
          {title}
        </h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

/** A medal: lime when earned; grey with progress and "x af y" while locked. */
export function AchievementMedal({
  icon,
  title,
  description,
  earned,
  value,
  threshold,
  progressLabel,
  compact = false,
}: {
  icon: string;
  title: string;
  description: string;
  earned: boolean;
  value: number;
  threshold: number;
  /** "21 af 30" */
  progressLabel: string;
  compact?: boolean;
}) {
  const pct = threshold > 0 ? Math.round((Math.min(value, threshold) / threshold) * 100) : 0;
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col items-center gap-2 rounded-md bg-surface-soft px-2.5 pb-3.5 pt-4 text-center shadow-soft-line',
        compact && 'w-36 flex-none snap-start',
      )}
    >
      <span
        className={cn(
          'grid size-14 place-items-center rounded-full',
          earned
            ? 'bg-medal text-navy shadow-medal'
            : 'bg-medal-locked text-fg-3 shadow-medal-locked',
        )}
      >
        <Icon icon={MEDAL_ICONS[icon] ?? Trophy} size={24} />
      </span>
      <strong className="text-table leading-snug">{title}</strong>
      <span className="text-micro leading-snug text-fg-2">{description}</span>
      {!earned && (
        <>
          <progress
            className="profile-progress h-1.5 w-full"
            value={pct}
            max={100}
            aria-label={`${title}: ${progressLabel}`}
          />
          <span className="text-micro text-fg-2">{progressLabel}</span>
        </>
      )}
    </li>
  );
}

/** The streak band: flame medal, "9 dage i træk", "… din bedste er 14". */
export function StreakBand({ headline, sub }: { headline: string; sub: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-md bg-streak px-4 py-3.5">
      <span className="grid size-12 flex-none place-items-center rounded-full bg-medal text-navy shadow-medal">
        <Icon icon={Flame} size={24} />
      </span>
      <span className="flex flex-col leading-tight">
        <strong className="text-profile-streak font-bold tracking-tight">{headline}</strong>
        <span className="text-meta text-fg-1">{sub}</span>
      </span>
    </div>
  );
}

const LEVEL_BG = ['bg-heat-0', 'bg-heat-1', 'bg-primary', 'bg-heat-3', 'bg-fg-1'] as const;

/**
 * 12 weeks of activity as a grid of 84 days, five levels and a legend. One image for screen
 * readers, with a label that says what it shows; the numbers are in the lines under it.
 */
export function ActivityHeatmap({
  days,
  label,
  less,
  more,
  cell = 'desktop',
}: {
  days: { date: string; level: 0 | 1 | 2 | 3 | 4; title: string }[];
  label: string;
  less: string;
  more: string;
  cell?: 'desktop' | 'mobile';
}) {
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) =>
    days.slice(w * 7, w * 7 + 7),
  );
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={label} className="flex justify-between gap-1">
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((d) => (
              <span
                key={d.date}
                title={d.title}
                className={cn(
                  'block rounded-cell',
                  cell === 'desktop' ? 'size-4.5' : 'size-4.5 max-[360px]:size-3.5',
                  LEVEL_BG[d.level],
                )}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between" aria-hidden>
        <span className="text-meta text-fg-2">{less}</span>
        <span className="flex gap-1">
          {LEVEL_BG.map((bg) => (
            <i key={bg} className={cn('block size-3 rounded-3xs', bg)} />
          ))}
        </span>
        <span className="text-meta text-fg-2">{more}</span>
      </div>
    </div>
  );
}

/** A row in a profile card: icon tile, title and meta, and an action on the right. */
export function ProfileRow({
  icon,
  title,
  meta,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 py-3.5 shadow-row-divider last:pb-0 last:shadow-none">
      <span className="grid size-10 flex-none place-items-center rounded-node bg-bg-base text-fg-1">
        <Icon icon={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <strong className="text-body font-semibold">{title}</strong>
        {meta && <span className="text-meta text-fg-2">{meta}</span>}
      </span>
      {action}
    </div>
  );
}
