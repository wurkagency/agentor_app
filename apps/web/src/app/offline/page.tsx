import { getTranslations } from 'next-intl/server';
import { OfflineView } from './offline-view';

export async function generateMetadata() {
  const t = await getTranslations('mobile.offline');
  return { title: t('title') };
}

/**
 * Offline (PLAN-MOBILE M3): precached by the service worker and shown when a page can't load.
 * No session and no server data: everything comes from this device's snapshot.
 */
export default function OfflinePage() {
  return <OfflineView />;
}
