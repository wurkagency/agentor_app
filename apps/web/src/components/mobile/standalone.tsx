'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const QUERY = '(display-mode: standalone)';

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

/** True when the app runs from the home screen (installed PWA). iOS also sets navigator.standalone. */
export function useStandalone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      window.matchMedia(QUERY).matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

/** Renders its children only in the browser, not in the installed app (MA10 install row). */
export function HideWhenInstalled({ children }: { children: ReactNode }) {
  return useStandalone() ? null : <>{children}</>;
}
