'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * One clock for relative times ("for 3 min. siden"). The server's request time is the first
 * value on both sides, so hydration renders the same text; after mount it follows the real time.
 */
const NowContext = createContext<number | null>(null);

export function NowProvider({ initial, children }: { initial: number; children: ReactNode }) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow(): Date {
  const now = useContext(NowContext);
  return useMemo(() => (now === null ? new Date() : new Date(now)), [now]);
}
