'use client';

import { Button, Icon, cn } from '@agentor/ui';
import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Overblik · Personlige oplysninger · Login og sikkerhed · Notifikationer (PR1/D15): anchor links
 * that follow the scroll. The current section has aria-current.
 */
export function ProfileAnchorNav({
  label,
  items,
}: {
  label: string;
  items: { id: string; label: string }[];
}) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  useEffect(() => {
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav
      aria-label={label}
      className="sticky top-2 z-10 flex gap-1.5 self-center rounded-full bg-surface p-1.5 shadow-sm"
    >
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          aria-current={active === i.id ? 'true' : undefined}
          onClick={() => setActive(i.id)}
          className={cn(
            'inline-flex h-9 items-center rounded-full px-4 text-table font-semibold text-fg-2 no-underline hover:text-fg-1',
            active === i.id && 'bg-fg-1 text-white hover:text-white',
          )}
        >
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** "Redigér profil": jumps to Personlige oplysninger and puts the cursor in the first field. */
export function EditProfileButton({ label }: { label: string }) {
  return (
    <Button
      variant="primary"
      size="m"
      onClick={() => {
        const section = document.getElementById('oplysninger');
        section?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
        section?.querySelector<HTMLInputElement>('input:not([readonly]):not([type=file])')?.focus({
          preventScroll: true,
        });
      }}
    >
      <Icon icon={Pencil} size={16} />
      {label}
    </Button>
  );
}
