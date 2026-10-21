import { formatMinutes, type Locale } from '@agentor/i18n';
import { cn } from '@agentor/ui';
import { ChipGroup, MobileEmpty, MobilePageTitle, MobileShell } from '@agentor/ui/mobile';
import { MessageSquare } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { BoardCase } from '@/components/platform/case-board';
import { PriorityBadge } from '@/components/platform/case-bits';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { mobileDue } from './due';
import { MobileNewCase } from './mobile-new-case';

export type CaseFilter = 'mine' | 'unassigned' | 'waiting';

const OPEN = new Set(['new', 'in_progress', 'waiting']);
const ORDER = { critical: 0, high: 1, normal: 2, low: 3 } as const;

/**
 * MP02 Sager: a list instead of the board. Chips for my cases, unassigned and waiting; priority
 * without status colours (decision 17); the reply deadline in words.
 */
export async function CasesMobile({
  cases,
  userId,
  filter,
  minutesToday,
  customers,
}: {
  cases: BoardCase[];
  userId: string;
  filter: CaseFilter;
  minutesToday: number;
  customers: { id: string; name: string }[];
}) {
  const t = await getTranslations('mobile.platform.cases');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const open = cases.filter((c) => OPEN.has(c.status));
  const sets: Record<CaseFilter, BoardCase[]> = {
    mine: open.filter((c) => c.assigneeId === userId),
    unassigned: open.filter((c) => !c.assigneeId),
    waiting: open.filter((c) => c.status === 'waiting'),
  };
  const shown = [...sets[filter]].sort(
    (a, b) =>
      ORDER[a.priority] - ORDER[b.priority] ||
      (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') ||
      b.number - a.number,
  );
  const due = (c: BoardCase) => mobileDue(t, c, now, locale);

  return (
    <MobileShell topBar={<PlatformTopBar />}>
      <MobilePageTitle
        title={t('title')}
        aside={
          <Link href="/platform/support/time" className="font-semibold text-fg-1 no-underline">
            {t('today', { time: formatMinutes(minutesToday, locale) })} ›
          </Link>
        }
      />
      <ChipGroup
        label={t('filterLabel')}
        value={filter}
        linkAs={Link}
        items={[
          {
            key: 'mine',
            label: t('mine', { count: sets.mine.length }),
            href: '/platform/support/cases',
          },
          {
            key: 'unassigned',
            label: t('unassigned', { count: sets.unassigned.length }),
            href: '/platform/support/cases?filter=unassigned',
          },
          {
            key: 'waiting',
            label: t('waiting', { count: sets.waiting.length }),
            href: '/platform/support/cases?filter=waiting',
          },
          { key: 'archive', label: t('archive'), href: '/platform/support/cases?view=archive' },
        ]}
      />
      {shown.length === 0 ? (
        <MobileEmpty icon={MessageSquare} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((c) => {
            const d = due(c);
            return (
              <li key={c.id}>
                <Link
                  href={`/platform/support/cases/${c.id}`}
                  className="flex flex-col gap-1.5 rounded-xl bg-surface px-3.5 py-3 text-fg-1 no-underline shadow-sm"
                >
                  <span className="flex items-center justify-between">
                    <span className="font-mono text-micro text-fg-2">#{c.number}</span>
                    <PriorityBadge priority={c.priority} />
                  </span>
                  <strong className="text-body font-semibold">{c.title}</strong>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-meta text-fg-2">{c.tenantName}</span>
                    <span className={cn('text-micro font-semibold', d?.tone ?? 'text-fg-2')}>
                      {d?.text ?? t('noDue')}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <MobileNewCase customers={customers} />
    </MobileShell>
  );
}
