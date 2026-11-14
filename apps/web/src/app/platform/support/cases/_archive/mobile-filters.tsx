'use client';

import { cn } from '@agentor/ui';
import { Modal } from '@agentor/ui/mobile';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ArchiveQuery } from './rows';

export interface FilterDef {
  key: 'period' | 'customer' | 'category' | 'supporter';
  label: string;
  /** Shown when the filter has no value (period: "Sidste 30 dage"). */
  defaultLabel?: string;
  /** Drawn as active even without a value (the period always applies). */
  always?: boolean;
  /** '' is "Alle" (or the default period). */
  options: { value: string; label: string }[];
}

// Same drawing as ChipGroup (32 px, 44 px hit area); these open a sheet, so they are buttons with
// aria-haspopup, and several can be active at once.
const CHIP =
  'touch-target inline-flex h-8 flex-none cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-0 px-3.5 font-sans text-table box-border';

/** MP13 filter chips: Periode, Kunde, Kategori, Supporter, each picks in a sheet. */
export function ArchiveFilters({ filters, query }: { filters: FilterDef[]; query: ArchiveQuery }) {
  const t = useTranslations('mobile.archive');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState<FilterDef['key'] | null>(null);
  const current = filters.find((f) => f.key === open) ?? null;
  const pick = (key: FilterDef['key'], value: string) => {
    const p = new URLSearchParams(
      Object.entries(query).filter(([k, v]) => k !== 'view' && typeof v === 'string' && v) as [
        string,
        string,
      ][],
    );
    if (value) p.set(key, value);
    else p.delete(key);
    setOpen(null);
    router.push(`/platform/support/cases?view=archive${p.size ? `&${p}` : ''}`);
  };

  return (
    <>
      <div
        role="group"
        aria-label={t('filterLabel')}
        className="no-scrollbar -mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5"
      >
        {filters.map((f) => {
          const value = query[f.key] ?? '';
          const chosen = f.options.find((o) => o.value === value && value);
          const on = Boolean(chosen) || Boolean(f.always);
          const text = chosen?.label ?? f.defaultLabel ?? f.label;
          return (
            <button
              key={f.key}
              type="button"
              aria-haspopup="dialog"
              aria-label={chosen || f.always ? `${f.label}: ${text}` : f.label}
              onClick={() => setOpen(f.key)}
              className={cn(
                CHIP,
                on
                  ? 'bg-fg-1 font-semibold text-white'
                  : 'bg-white font-medium text-fg-1 shadow-ring-chip',
              )}
            >
              {text}
              <ChevronDown aria-hidden width={14} height={14} />
            </button>
          );
        })}
      </div>
      <Modal
        open={current !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={current?.label ?? ''}
        closeLabel={tc('close')}
      >
        {current && (
          <ul className="m-0 flex list-none flex-col p-0">
            {current.options.map((o) => {
              const on = (query[current.key] ?? '') === o.value;
              return (
                <li key={o.value || 'all'} className="shadow-hairline-t first:shadow-none">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(current.key, o.value)}
                    className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-1 text-left font-sans text-body text-fg-1"
                  >
                    <span className={on ? 'font-semibold' : undefined}>{o.label}</span>
                    {on && <Check aria-hidden width={18} height={18} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
