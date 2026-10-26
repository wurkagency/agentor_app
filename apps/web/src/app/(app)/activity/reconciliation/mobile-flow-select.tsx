'use client';

import { MOBILE_INPUT } from '@agentor/ui/mobile';
import { usePathname, useRouter } from 'next/navigation';

/** MA28 flow choice: a native select (the phone's own picker); the choice is the URL. */
export function MobileFlowSelect({
  flows,
  value,
  label,
  period,
}: {
  flows: { id: string; name: string }[];
  value: string;
  label: string;
  /** Kept when the flow changes. */
  period?: string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams({ flow: e.target.value, ...(period ? { period } : {}) });
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      className={`${MOBILE_INPUT} cursor-pointer bg-white`}
    >
      {flows.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
