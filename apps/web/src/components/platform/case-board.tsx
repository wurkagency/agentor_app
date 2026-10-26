'use client';

import { formatMinutes, type Locale } from '@agentor/i18n';
import { FilterChip, Icon, SearchInput, cn, toast } from '@agentor/ui';
import { Archive, CircleX, MessageCircle, Plus, Timer, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type DragEvent } from 'react';
import { updateCaseAction } from '@/app/platform/actions';
import { FilterMenu } from '../filter-menu';
import {
  AssigneeAvatar,
  DueLabel,
  PriorityBadge,
  dueText,
  type CaseStatusKey,
  type Priority,
} from './case-bits';
import { NewCaseDialog } from './new-case-dialog';
import { useNow } from '@/components/now';

export interface BoardCase {
  id: string;
  number: number;
  title: string;
  tenantId: string;
  tenantName: string;
  tenantInitials: string;
  status: CaseStatusKey;
  priority: Priority;
  category: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  updatedAt: string;
  resolvedAt: string | null;
  notes: number;
  minutes: number;
  errors: number;
}

const COLUMNS: CaseStatusKey[] = ['new', 'in_progress', 'waiting', 'resolved'];
const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Supportsager som tavle (S1): Ny · I gang · Venter på kunde · Løst. Drag a card to another
 * column to change its status; the case page has the same choice for keyboard users.
 */
export function CaseBoard({
  cases,
  userId,
  customers,
  view,
  archived,
}: {
  cases: BoardCase[];
  userId: string;
  customers: { id: string; name: string }[];
  view: 'board' | 'list';
  archived: number;
}) {
  const t = useTranslations('platform.cases');
  const tc = useTranslations('platform.case');
  const tco = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  // The filters live in the URL, so a filtered board can be shared and survives a reload.
  const pathname = usePathname();
  const params = useSearchParams();
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q.trim()) setParam('q', q.trim() || null);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const mine = params.get('mine') === '1';
  const unassigned = params.get('unassigned') === '1';
  const priorityParam = params.get('priority');
  const priority =
    (['critical', 'high', 'normal', 'low'] as const).find((p) => p === priorityParam) ?? null;
  const customer = params.get('customer');
  const category = params.get('category');
  const setMine = (on: boolean) => setParam('mine', on ? '1' : null);
  const setUnassigned = (on: boolean) => setParam('unassigned', on ? '1' : null);
  const setPriority = (v: Priority | null) => setParam('priority', v);
  const setCustomer = (v: string | null) => setParam('customer', v);
  const setCategory = (v: string | null) => setParam('category', v);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<CaseStatusKey | null>(null);
  const [local, setLocal] = useState<Record<string, CaseStatusKey>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [, start] = useTransition();
  const now = useNow();

  const list = useMemo(
    () =>
      cases
        .map((c) => ({ ...c, status: local[c.id] ?? c.status }))
        .filter((c) => {
          const query = q.trim().toLowerCase();
          if (query && !`#${c.number} ${c.title} ${c.tenantName}`.toLowerCase().includes(query))
            return false;
          if (mine && c.assigneeId !== userId) return false;
          if (unassigned && c.assigneeId) return false;
          if (priority && c.priority !== priority) return false;
          if (customer && c.tenantId !== customer) return false;
          if (category && c.category !== category) return false;
          return true;
        })
        .sort(
          (a, b) =>
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
            (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'),
        ),
    [cases, local, q, mine, unassigned, priority, customer, category, userId],
  );
  const unassignedCount = cases.filter((c) => !c.assigneeId && c.status !== 'resolved').length;

  const move = (id: string, status: CaseStatusKey) => {
    const c = cases.find((x) => x.id === id);
    if (!c || (local[id] ?? c.status) === status) return;
    setLocal((m) => ({ ...m, [id]: status }));
    start(async () => {
      const res = await updateCaseAction(id, { status });
      if (!res.ok) {
        setLocal((m) => ({ ...m, [id]: c.status }));
        toast.error({ title: tc('errors.generic'), closeLabel: tco('close') });
        return;
      }
      toast.ok({
        title: t('moved', { n: c.number, status: tc(`status.${status}`) }),
        closeLabel: tco('close'),
      });
      router.refresh();
    });
  };

  const card = (c: BoardCase & { status: CaseStatusKey }) => {
    const due = dueText((k, p) => tc(k, p), c, now, locale);
    return (
      <li
        key={c.id}
        draggable
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.setData('text/plain', c.id);
          setDragging(c.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        className={cn(
          'flex flex-col gap-2 rounded-md bg-surface p-4 shadow-sm',
          dragging === c.id && 'opacity-60',
          c.priority === 'critical' && c.status !== 'resolved' && 'shadow-ring-dark-2',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-mono text-fg-2">#{c.number}</span>
          <PriorityBadge priority={c.priority} />
        </div>
        <Link
          href={`/platform/support/cases/${c.id}`}
          className="text-body font-semibold text-fg-1 no-underline hover:underline"
        >
          {c.title}
        </Link>
        <span className="flex items-center gap-2 text-meta text-fg-2">
          <span className="grid h-5 min-w-6 place-items-center rounded-xs bg-bg-base px-1 text-nano font-semibold text-fg-1 shadow-ring-chip">
            {c.tenantInitials}
          </span>
          {c.tenantName}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
          <DueLabel {...due} />
          {c.errors > 0 && c.status !== 'resolved' && (
            <span className="inline-flex items-center gap-1 text-meta text-error-fg">
              <Icon icon={CircleX} size={14} />
              {t('errors', { count: c.errors })}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 text-meta text-fg-2"
            title={t('notesTitle')}
          >
            <Icon icon={MessageCircle} size={14} />
            {c.notes}
          </span>
          <span className="inline-flex items-center gap-1 text-meta text-fg-2">
            <Icon icon={Timer} size={14} />
            {formatMinutes(c.minutes, locale)}
          </span>
          <span className="ml-auto">
            <AssigneeAvatar name={c.assigneeName} />
          </span>
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label={t('search')}
          placeholder={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full md:w-80"
        />
        <FilterChip active={mine} onClick={() => setMine(!mine)}>
          {t('mine')}
          {mine && <Icon icon={X} size={14} />}
        </FilterChip>
        <FilterChip active={unassigned} onClick={() => setUnassigned(!unassigned)}>
          {t('unassigned', { count: unassignedCount })}
        </FilterChip>
        <FilterMenu
          label={t('priority')}
          allLabel={t('all')}
          value={priority}
          onChange={setPriority}
          options={(['critical', 'high', 'normal', 'low'] as Priority[]).map((p) => ({
            value: p,
            label: tc(`priority.${p}`),
          }))}
        />
        <FilterMenu
          label={t('customer')}
          allLabel={t('all')}
          value={customer}
          onChange={setCustomer}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterMenu
          label={t('category')}
          allLabel={t('all')}
          value={category}
          onChange={setCategory}
          options={[
            'error',
            'mapping',
            'connection',
            'setup',
            'subscription',
            'wish',
            'question',
          ].map((k) => ({
            value: k,
            label: tc(`category.${k}`),
          }))}
        />
      </div>

      {view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = list.filter((c) => c.status === col);
            const shown = col === 'resolved' ? items.slice(0, 2) : items;
            return (
              <section
                key={col}
                aria-label={tc(`status.${col}`)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col);
                }}
                onDragLeave={() => setOver((o) => (o === col ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain');
                  setOver(null);
                  if (id) move(id, col);
                }}
                className={cn(
                  'flex min-h-40 flex-col gap-3 rounded-md bg-bg-base p-3',
                  over === col && 'shadow-ring-lime',
                )}
              >
                <div className="flex items-center justify-between px-1">
                  <h2 className="m-0 text-table font-semibold">
                    {tc(`status.${col}`)}{' '}
                    <span className="font-normal text-fg-2">{items.length}</span>
                  </h2>
                  {col === 'new' ? (
                    <button
                      type="button"
                      aria-label={t('new')}
                      onClick={() => setNewOpen(true)}
                      className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1 hover:bg-surface"
                    >
                      <Icon icon={Plus} size={16} />
                    </button>
                  ) : col === 'resolved' ? (
                    <span className="text-micro text-fg-2">{t('archivedAfter')}</span>
                  ) : null}
                </div>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">{shown.map(card)}</ul>
                {col === 'resolved' && (
                  <Link
                    href="/platform/support/cases?view=archive"
                    className="flex h-10 items-center justify-center gap-2 rounded-full text-table font-semibold text-fg-1 no-underline shadow-ring-chip"
                  >
                    <Icon icon={Archive} size={16} />
                    {t('moreArchive', {
                      count: Math.max(0, items.length - shown.length) + archived,
                    })}
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.filter((c) => c.status !== 'resolved').map(card)}
        </ul>
      )}
      {newOpen && <NewCaseDialog customers={customers} onClose={() => setNewOpen(false)} />}
    </>
  );
}
