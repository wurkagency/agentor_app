import { OFFLINE_DB } from './device-data';

/**
 * The last overview, integrations and activity the user saw, for reading offline (PLAN-MOBILE
 * M3, produktspecifikation §8). Stored in IndexedDB under "<userId>:<tenantId>", aggregates and
 * display texts only (no request/response bodies, no customer names), and cleared on logout,
 * company switch and 401 (lib/device-data.ts).
 */

export type SnapshotPage = 'overview' | 'integrations' | 'activity';

export interface OfflineSnapshot {
  owner: string;
  savedAt: string;
  company: string;
  overview?: {
    headline: string;
    meta: string;
    problems: boolean;
    kpis: { label: string; value: string; meta: string }[];
    rows: { title: string; meta: string; status: string }[];
  };
  integrations?: { name: string; meta: string; status: string; statusLabel: string }[];
  activity?: { day: string; title: string; meta: string; time: string }[];
}

const STORE = 'snapshots';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(OFFLINE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        } finally {
          db.close();
        }
      }),
  );
}

/** Merges one page into the user's snapshot and records whose it is. */
export async function saveSnapshot(
  owner: string,
  company: string,
  page: SnapshotPage,
  data: NonNullable<OfflineSnapshot[SnapshotPage]>,
): Promise<void> {
  const current = (await tx<OfflineSnapshot>('readonly', (s) => s.get(owner))) ?? null;
  const next: OfflineSnapshot = {
    ...(current && current.owner === owner ? current : { owner, company }),
    owner,
    company,
    savedAt: new Date().toISOString(),
    [page]: data,
  };
  await tx('readwrite', (s) => s.put(next, owner));
  await tx('readwrite', (s) => s.put(owner, '__current'));
}

/** The snapshot of the user who used the device last (the offline page has no session). */
export async function readCurrentSnapshot(): Promise<OfflineSnapshot | null> {
  const owner = await tx<string>('readonly', (s) => s.get('__current'));
  if (!owner) return null;
  return tx<OfflineSnapshot>('readonly', (s) => s.get(owner));
}
