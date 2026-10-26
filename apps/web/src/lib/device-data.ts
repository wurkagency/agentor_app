/**
 * What this device keeps for the signed-in user (PLAN-MOBILE M3, produktspecifikation §8): the
 * offline snapshot in IndexedDB and the Web Push subscription. Both are removed on logout, on a
 * change of company and on 401, so the next person on the device sees nothing of the last one.
 */

export const OFFLINE_DB = 'agentor-offline';

/** Deletes the offline snapshot database. Resolves even when blocked or unavailable. */
export function clearOfflineSnapshot(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve();
      const req = indexedDB.deleteDatabase(OFFLINE_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Unsubscribes this device from Web Push; the server row is removed by the caller's action. */
export async function unsubscribeDevicePush(): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/** Everything the device holds for the user. */
export async function clearDeviceData(): Promise<string | null> {
  const [, endpoint] = await Promise.all([clearOfflineSnapshot(), unsubscribeDevicePush()]);
  return endpoint;
}
