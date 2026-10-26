'use client';

import { SearchInput } from '@agentor/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FilterMenu } from '../filter-menu';

export interface QueryFilter {
  key: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
}

/** Search plus single-choice filters kept in the URL, so a filtered list can be shared (S2). */
export function QueryFilters({
  searchLabel,
  filters,
}: {
  searchLabel: string;
  filters: QueryFilter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) set('q', q.trim() || null);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full md:w-96"
      />
      {filters.map((f) => (
        <FilterMenu
          key={f.key}
          label={f.label}
          allLabel={f.allLabel}
          value={params.get(f.key)}
          onChange={(v) => set(f.key, v)}
          options={f.options}
        />
      ))}
    </div>
  );
}
