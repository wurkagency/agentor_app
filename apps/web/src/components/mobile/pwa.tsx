'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { unsubscribePush } from '@/app/actions/push';
import { clearDeviceData, clearOfflineSnapshot } from '@/lib/device-data';
import { saveSnapshot, type OfflineSnapshot, type SnapshotPage } from '@/lib/offline-snapshot';

const OWNER_KEY = 'agentor:device-owner';

/** Registers the service worker once per page load (PLAN-MOBILE M3). */
export function PwaRegister({ dev }: { dev: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // A push while the app is open: refresh, so the bell and lists show it at once.
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'agentor:push') router.refresh();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // In development the worker skips its shell cache, so HMR chunks are never served stale.
    navigator.serviceWorker.register(dev ? '/sw.js?dev=1' : '/sw.js', { scope: '/' }).catch(() => {
      // No service worker (private mode, old browser): the app works without it.
    });
  }, [dev]);
  return null;
}

/**
 * Clears what the device holds when someone else, or another company, is now using it: the
 * offline snapshot and the push subscription (produktspecifikation §8, B12). `owner` is
 * "<userId>:<tenantId>", or null on the login page (signed out or 401).
 */
export function DeviceGuard({ owner }: { owner: string | null }) {
  useEffect(() => {
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(OWNER_KEY);
    } catch {
      return;
    }
    if (owner === previous) return;
    void (async () => {
      if (previous) {
        if (owner) {
          // Same browser, new person or company: the old company's push row stays useless, so
          // drop the browser subscription; MA11 offers to turn push on again.
          await clearDeviceData();
        } else await clearOfflineSnapshot();
      }
      try {
        if (owner) localStorage.setItem(OWNER_KEY, owner);
        else localStorage.removeItem(OWNER_KEY);
      } catch {
        // Private mode.
      }
    })();
  }, [owner]);
  return null;
}

/** Writes this page's aggregates to the offline snapshot after it rendered (MA02, MA04, MA07). */
export function SnapshotWriter<P extends SnapshotPage>({
  owner,
  company,
  page,
  data,
}: {
  owner: string;
  company: string;
  page: P;
  data: NonNullable<OfflineSnapshot[P]>;
}) {
  useEffect(() => {
    void saveSnapshot(owner, company, page, data);
  }, [owner, company, page, data]);
  return null;
}

/** Logout helper: device data first, then the server row for this device. */
export async function forgetDevice(): Promise<void> {
  const endpoint = await clearDeviceData();
  if (endpoint) await unsubscribePush(endpoint).catch(() => undefined);
  try {
    localStorage.removeItem(OWNER_KEY);
    navigator.serviceWorker?.controller?.postMessage({ type: 'agentor:logout' });
  } catch {
    // Nothing to forget.
  }
}
