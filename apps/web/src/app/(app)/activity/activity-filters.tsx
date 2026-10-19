'use client';

import { Button, Icon, SearchInput, Segmented, toast } from '@agentor/ui';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FilterMenu } from '@/components/filter-menu';
import { retryFailures } from '../integrations/actions';
import { ENTITY_FILTERS, OUTCOME_FILTERS, type ActivityQuery } from './query';

export function ActivityFilters({
  query,
  flows,
  summary,
}: {
  query: ActivityQuery;
  flows: { id: string; name: string }[];
  summary: string;
}) {
  const t = useTranslations('activity');
  const tp = useTranslations('period');
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(query.q ?? '');
  const set = (patch: Partial<ActivityQuery>) => {
    const next = new URLSearchParams(
      Object.entries({ ...query, ...patch, before: undefined }).filter(([, v]) => v) as [
        string,
        string,
      ][],
    );
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: q.trim() || undefined });
        }}
      >
        <SearchInput
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
      </form>
      <FilterMenu
        label={t('filter.flow')}
        allLabel={t('filter.all')}
        value={query.flow ?? null}
        onChange={(v) => set({ flow: v ?? undefined })}
        options={flows.map((f) => ({ value: f.id, label: f.name }))}
      />
      <FilterMenu
        label={t('filter.entity')}
        allLabel={t('filter.all')}
        value={(query.entity as (typeof ENTITY_FILTERS)[number]) ?? null}
        onChange={(v) => set({ entity: v ?? undefined })}
        options={ENTITY_FILTERS.map((e) => ({ value: e, label: t(`entity.${e}`) }))}
      />
      <FilterMenu
        label={t('filter.outcome')}
        allLabel={t('filter.all')}
        value={(query.outcome as (typeof OUTCOME_FILTERS)[number]) ?? null}
        onChange={(v) => set({ outcome: v ?? undefined })}
        options={OUTCOME_FILTERS.map((o) => ({ value: o, label: t(`outcome.${o}`) }))}
      />
      <Segmented
        aria-label={tp('label')}
        value={(query.period as 'today' | '7d' | '30d') ?? 'today'}
        onValueChange={(v) => set({ period: v === 'today' ? undefined : v })}
        options={[
          { value: 'today', label: tp('today') },
          { value: '7d', label: tp('7d') },
          { value: '30d', label: tp('30d') },
        ]}
      />
      <span className="ml-auto text-meta text-fg-2" aria-live="polite">
        {summary}
      </span>
    </div>
  );
}

export function ActivityRetry({ flowId, routeId }: { flowId: string; routeId: string }) {
  const t = useTranslations('flows');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="s"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await retryFailures(flowId, routeId);
          if (res.ok) {
            toast.info({ title: t('retryStarted'), closeLabel: tc('close') });
            setTimeout(() => router.refresh(), 2500);
          } else toast.error({ title: t('actionFailed'), closeLabel: tc('close') });
        })
      }
    >
      {!pending && <Icon icon={RotateCw} size={14} />}
      {t('retryOne')}
    </Button>
  );
}
