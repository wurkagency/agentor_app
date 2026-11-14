'use client';

import { FilterChip, Select } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ACTION_GROUPS, type AuditQuery } from './query';

/** Filters live in the URL so a filtered view can be shared (designspecifikation §5.2). */
export function AuditFilters({
  members,
  query,
}: {
  members: { id: string; name: string }[];
  query: AuditQuery;
}) {
  const t = useTranslations('audit');
  const router = useRouter();
  const pathname = usePathname();
  const set = (key: keyof AuditQuery, value: string | undefined) => {
    const p = new URLSearchParams(
      Object.entries(query).filter(([k, v]) => k !== 'before' && typeof v === 'string') as [
        string,
        string,
      ][],
    );
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t('user')}
        density="compact"
        className="w-52 rounded-full"
        value={query.user ?? 'all'}
        onValueChange={(v) => set('user', v === 'all' ? undefined : v)}
        options={[
          { value: 'all', label: t('allUsers') },
          ...members.map((m) => ({ value: m.id, label: m.name })),
        ]}
      />
      <Select
        aria-label={t('action')}
        density="compact"
        className="w-52 rounded-full"
        value={query.group ?? 'all'}
        onValueChange={(v) => set('group', v === 'all' ? undefined : v)}
        options={[
          { value: 'all', label: t('allActions') },
          ...ACTION_GROUPS.map((g) => ({ value: g, label: t(`groups.${g}`) })),
        ]}
      />
      <Select
        aria-label={t('period')}
        density="compact"
        className="w-44 rounded-full"
        value={query.period ?? '30'}
        onValueChange={(v) => set('period', v === '30' ? undefined : v)}
        options={[
          { value: '7', label: t('last7') },
          { value: '30', label: t('last30') },
          { value: '90', label: t('last90') },
        ]}
      />
      <FilterChip
        active={query.support === '1'}
        onClick={() => set('support', query.support === '1' ? undefined : '1')}
      >
        {t('supportOnly')}
      </FilterChip>
    </div>
  );
}
