'use client';

import { ProfileCard, ProfileRow, Switch, toast } from '@agentor/ui';
import { BarChart3, Bell, CalendarClock, Unplug, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { setQuickNotificationAction } from '@/server/profile/actions';
import type { ProfileView } from '@/server/profile/view';

const ICONS: Record<string, LucideIcon> = {
  connection_broken: Unplug,
  systematic_error: Bell,
  quota: BarChart3,
  weekly_summary: CalendarClock,
};

/**
 * Notifikationer on the profile (D15): the four alerts, each on or off outside the app, and
 * "Alle indstillinger" for channels and quiet hours. Staff have no notification settings yet, so
 * their card says so instead of showing switches that do nothing.
 */
export function NotifyCard({ items }: { items: ProfileView['notifications'] }) {
  const t = useTranslations('profile.notify');
  const tc = useTranslations('common');
  const router = useRouter();
  const [, start] = useTransition();
  const [state, set] = useOptimistic(items ?? [], (cur, next: { event: string; on: boolean }) =>
    cur.map((x) => (x.event === next.event ? { ...x, on: next.on } : x)),
  );
  return (
    <ProfileCard
      id="notifikationer"
      title={t('heading')}
      meta={
        items ? (
          <Link href="/settings/notifications" className="text-table font-semibold text-fg-1">
            {t('all')}
          </Link>
        ) : undefined
      }
    >
      {items ? (
        <div>
          {state.map((n) => (
            <ProfileRow
              key={n.event}
              icon={ICONS[n.event] ?? Bell}
              title={n.label}
              meta={n.channels}
              action={
                <Switch
                  aria-label={n.label}
                  checked={n.on}
                  onCheckedChange={(on) =>
                    start(async () => {
                      set({ event: n.event, on });
                      const r = await setQuickNotificationAction(n.event as 'quota', on);
                      if (!r.ok) toast.error({ title: t('error'), closeLabel: tc('close') });
                      router.refresh();
                    })
                  }
                />
              }
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-body text-fg-2">{t('staffNone')}</p>
      )}
    </ProfileCard>
  );
}
