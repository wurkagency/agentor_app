'use client';

import { cn } from '@agentor/ui';
import { Modal } from '@agentor/ui/mobile';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

/**
 * The "Flow" chip on MA07 (B10): opens a modal with the flows as a list of links; the choice is a
 * URL, like the other chips.
 */
export function FlowPickerChip({
  label,
  title,
  closeLabel,
  allLabel,
  active,
  flows,
  hrefFor,
}: {
  label: string;
  title: string;
  closeLabel: string;
  allLabel: string;
  active: string | null;
  flows: { id: string; name: string }[];
  hrefFor: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const row =
    'flex min-h-14 items-center justify-between gap-3 px-1 text-body font-semibold text-fg-1 no-underline shadow-row-divider last:shadow-none';
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          'touch-target inline-flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-full border-0 px-3.5 font-sans text-table',
          active
            ? 'bg-fg-1 font-semibold text-white'
            : 'bg-white font-medium text-fg-1 shadow-ring-chip',
        )}
      >
        {label}
      </button>
      <Modal open={open} onOpenChange={setOpen} title={title} closeLabel={closeLabel}>
        <nav aria-label={title} className="flex flex-col">
          <Link href={hrefFor.all!} className={row} onClick={() => setOpen(false)}>
            {allLabel}
            {!active && <Check aria-hidden width={18} height={18} />}
          </Link>
          {flows.map((f) => (
            <Link
              key={f.id}
              href={hrefFor[f.id]!}
              className={row}
              aria-current={active === f.id ? 'true' : undefined}
              onClick={() => setOpen(false)}
            >
              {f.name}
              {active === f.id && <Check aria-hidden width={18} height={18} />}
            </Link>
          ))}
        </nav>
      </Modal>
    </>
  );
}
