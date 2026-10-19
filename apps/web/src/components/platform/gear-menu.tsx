'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  cn,
} from '@agentor/ui';
import {
  Activity,
  Clock,
  CircleX,
  Headphones,
  Lock,
  MessageCircle,
  Settings,
  Triangle,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

export interface GearCounts {
  openCases: number;
  mineCases: number;
  errorTypes: number;
  minutesToday: string;
}

/**
 * The gear in the top bar for Agentor staff (P1-Kunder-Menu): the Platform sections with a
 * short status each. Platformbrugere and Platformindstillinger are locked to Superadmin.
 */
export function GearMenu({
  role,
  counts,
  tone = 'navy',
}: {
  role: 'superadmin' | 'supporter';
  counts: GearCounts;
  tone?: 'navy' | 'light';
}) {
  const t = useTranslations('platform');
  const router = useRouter();
  const superadmin = role === 'superadmin';
  const items: { href: string; icon: LucideIcon; title: string; sub: string; locked?: boolean }[] =
    [
      {
        href: '/platform/customers',
        icon: Headphones,
        title: t('gear.customers'),
        sub: t('gear.customersSub'),
      },
      {
        href: '/platform/cases',
        icon: MessageCircle,
        title: t('gear.cases'),
        sub: t('gear.casesSub', { open: counts.openCases, mine: counts.mineCases }),
      },
      {
        href: '/platform/errors',
        icon: CircleX,
        title: t('gear.errors'),
        sub: t('gear.errorsSub', { count: counts.errorTypes }),
      },
      {
        href: '/platform/time',
        icon: Clock,
        title: t('gear.time'),
        sub: t('gear.timeSub', { time: counts.minutesToday }),
      },
      {
        href: '/platform/status',
        icon: Activity,
        title: t('gear.status'),
        sub: t('gear.statusSub'),
      },
      {
        href: '/platform/users',
        icon: UserRound,
        title: t('gear.users'),
        sub: t('gear.usersSub'),
        locked: !superadmin,
      },
      {
        href: '/platform/settings',
        icon: Settings,
        title: t('gear.settings'),
        sub: t('gear.settingsSub'),
        locked: !superadmin,
      },
    ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('gear.label')}
          className={cn(
            'grid size-10 cursor-pointer place-items-center rounded-full border-0',
            tone === 'navy' ? 'bg-primary text-fg-1' : 'bg-navy text-on-navy',
          )}
        >
          <Icon icon={Settings} size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-88 p-2">
        <div className="flex items-center justify-between px-2 pb-2 pt-1.5">
          <span className="eyebrow">{t('gear.title')}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2 py-0.5 text-micro font-semibold text-on-navy">
            <Icon icon={Triangle} size={14} className="fill-primary text-primary" />
            {t(`role.${role}`)}
          </span>
        </div>
        {items.map((it) => (
          <DropdownMenuItem
            key={it.href}
            disabled={Boolean(it.locked)}
            onSelect={() => router.push(it.href)}
            icon={<Icon icon={it.icon} size={18} className="mt-0.5" />}
            hint={
              it.locked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-bg-base px-2 py-0.5 text-micro">
                  <Icon icon={Lock} size={14} />
                  {t('role.superadmin')}
                </span>
              ) : undefined
            }
            className="h-auto items-start rounded-sm px-2 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium text-fg-1">{it.title}</span>
              <span className="text-meta font-normal text-fg-2">{it.sub}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <p className="m-0 border-t border-border px-2 pb-1 pt-3 text-meta text-fg-2">
          {t('gear.note')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
