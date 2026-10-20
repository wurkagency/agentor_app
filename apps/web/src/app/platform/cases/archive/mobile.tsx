import type { CaseRow } from '@agentor/db';
import { formatDate, formatMinutes, formatTime, type Locale } from '@agentor/i18n';
import {
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileEmpty,
  MobileFootnote,
  MobileShell,
} from '@agentor/ui/mobile';
import { Archive, Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { ArchiveFilters, type FilterDef } from './mobile-filters';
import type { ArchiveQuery } from './rows';

const CATEGORIES = ['error', 'mapping', 'connection', 'setup', 'subscription', 'wish', 'question'];

/**
 * MP13 Arkiv (S2): resolved and closed cases with search in title, resolution and notes, and the
 * same filters as desktop as chips that open a sheet. Each case folds out to its resolution.
 */
export async function ArchiveMobile({
  rows,
  count,
  totalMinutes,
  query,
  customers,
  staff,
}: {
  rows: CaseRow[];
  count: number;
  totalMinutes: number;
  query: ArchiveQuery;
  customers: { value: string; label: string }[];
  staff: { value: string; label: string }[];
}) {
  const t = await getTranslations('platform.archive');
  const tc = await getTranslations('platform.case');
  const tm = await getTranslations('mobile.archive');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const day = (d: Date) => formatDate(d, locale).replace(/ \d{4}$/, '');
  const resolved = (d: Date) =>
    d.toDateString() === now.toDateString() ? tm('today', { time: formatTime(d, locale) }) : day(d);
  const filters: FilterDef[] = [
    {
      key: 'period',
      label: t('period'),
      defaultLabel: t('last30'),
      always: true,
      options: [
        { value: '', label: t('last30') },
        { value: '90d', label: t('last90') },
        { value: '365d', label: t('last365') },
        { value: 'all', label: t('allTime') },
      ],
    },
    {
      key: 'customer',
      label: t('customer'),
      options: [{ value: '', label: t('all') }, ...customers],
    },
    {
      key: 'category',
      label: t('category'),
      options: [
        { value: '', label: t('all') },
        ...CATEGORIES.map((k) => ({ value: k, label: tc(`category.${k}`) })),
      ],
    },
    {
      key: 'supporter',
      label: t('supporter'),
      options: [{ value: '', label: t('all') }, ...staff],
    },
  ];
  const keep = Object.entries(query).filter(
    ([k, v]) => k !== 'q' && typeof v === 'string' && v,
  ) as [string, string][];

  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back="/platform/cases"
          title={t('title')}
          subtitle={tm('count', { count })}
        />
      }
    >
      <form action="/platform/cases/archive" role="search" className="flex">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-surface px-4 text-fg-2 shadow-sm">
          <Search aria-hidden width={18} height={18} />
          <span className="sr-only">{tm('searchLabel')}</span>
          <input
            name="q"
            type="search"
            defaultValue={query.q ?? ''}
            placeholder={tm('search')}
            className="min-w-0 flex-1 border-0 bg-transparent font-sans text-m-input text-fg-1 outline-none"
          />
          {keep.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        </label>
      </form>
      <ArchiveFilters filters={filters} query={query} />
      {rows.length === 0 ? (
        <MobileEmpty icon={Archive} title={t('empty')}>
          {t('emptyBody')}
        </MobileEmpty>
      ) : (
        rows.map((r, i) => (
          <ExpandCard
            key={r.id}
            open={i === 0}
            leading={
              <span className="w-11 flex-none font-mono text-micro text-fg-2">#{r.number}</span>
            }
            title={r.title}
            meta={`${r.tenantName} · ${formatMinutes(r.minutes, locale)}`}
          >
            <KV k={tm('resolution')}>{r.resolution || '–'}</KV>
            <KV k={t('customer')}>{r.tenantName}</KV>
            <KV k={t('category')}>{tc(`category.${r.category}`)}</KV>
            <KV k={t('supporter')}>{r.assigneeName ?? '–'}</KV>
            <KV k={t('colCreated')}>{day(r.createdAt)}</KV>
            <KV k={t('colResolved')}>{r.resolvedAt ? resolved(r.resolvedAt) : '–'}</KV>
            <KV k={t('colTime')}>
              <strong>{formatMinutes(r.minutes, locale)}</strong>
            </KV>
            <CardActions>
              <CardButton href={`/platform/cases/${r.id}`} linkAs={Link}>
                {tm('open')}
              </CardButton>
            </CardActions>
          </ExpandCard>
        ))
      )}
      <MobileFootnote>
        {t('footer', {
          shown: rows.length,
          total: count,
          time: formatMinutes(totalMinutes, locale),
        })}
      </MobileFootnote>
    </MobileShell>
  );
}
