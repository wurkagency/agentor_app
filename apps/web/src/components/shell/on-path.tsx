'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Renders its children only under a path prefix (e.g. the open period beside Rapporter). */
export function OnPath({ prefix, children }: { prefix: string; children: ReactNode }) {
  const pathname = usePathname();
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? children : null;
}
