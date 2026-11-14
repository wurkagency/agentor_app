'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** While a connection is being checked by the worker, refresh until the result is in. */
export function CheckingRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
