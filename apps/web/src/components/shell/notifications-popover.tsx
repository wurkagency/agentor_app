'use client';

import { formatDate, formatRelative } from '@agentor/i18n';
import {
  Button,
  cn,
  EmptyState,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@agentor/ui';
import { BellOff, CircleX, Info, Unplug } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { markAllNotificationsRead } from '@/app/actions/notifications';
import { useNow } from '@/components/now';

export interface NotificationItem {
  id: string;
  event: string;
  messageKey: string;
  params: Record<string, string | number>;
  href: string | null;
  needsAction: boolean;
  resolved: boolean;
  read: boolean;
  createdAt: string;
}

const ICON: Record<string, typeof Info> = {
  connection_broken: Unplug,
  record_failed: CircleX,
  systematic_error: CircleX,
};

/**
 * Notifications popover (D2-Notifikationer): 400 px, "Kræver handling" and "Alle", footer link
 * to settings. Opening it marks everything as read; items stay until their cause is resolved.
 */
export function NotificationsPopover({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: NotificationItem[];
}) {
  const t = useTranslations('notificationsPanel');
  const locale = useLocale() as 'da' | 'en';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = items.filter((i) => i.needsAction && !i.resolved);
  const now = useNow();

  const list = (rows: NotificationItem[]) =>
    rows.length === 0 ? (
      <EmptyState icon={BellOff} title={t('emptyTitle')}>
        {t('emptyBody')}
      </EmptyState>
    ) : (
      <ul className="m-0 flex max-h-96 list-none flex-col overflow-y-auto p-0">
        {rows.map((n) => {
          const created = new Date(n.createdAt);
          const when =
            now.getTime() - created.getTime() > 2 * 86_400_000
              ? formatDate(created, locale)
              : formatRelative(created, now, locale);
          return (
            <li
              key={n.id}
              className="flex items-start gap-3 border-t border-border py-3 first:border-0"
            >
              <Icon
                icon={ICON[n.event] ?? Info}
                size={16}
                className={cn(
                  'mt-0.5',
                  n.needsAction && !n.resolved ? 'text-error-fg' : 'text-fg-2',
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className={cn('m-0 text-table', !n.read && 'font-semibold')}>
                  {t(
                    `items.${n.messageKey}` as 'items.recordsFailed',
                    n.params as Record<string, string>,
                  )}
                </p>
                <p className="m-0 text-meta text-fg-2">
                  {[n.params.flow ?? n.params.name, when].filter(Boolean).join(' · ')}
                  {n.resolved && ` · ${t('resolved')}`}
                </p>
              </div>
              {n.href && n.needsAction && !n.resolved && (
                <Button variant="secondary" size="s" asChild>
                  <Link href={n.href} onClick={() => setOpen(false)}>
                    {t(`actions.${n.event}` as 'actions.record_failed')}
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && items.some((i) => !i.read))
          void markAllNotificationsRead().then(() => router.refresh());
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-100" aria-label={t('title')}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="m-0 text-card">{t('title')}</h2>
        </div>
        <Tabs defaultValue={action.length ? 'action' : 'all'} className="px-5">
          <TabsList dense>
            <TabsTrigger dense value="action">
              {t('needsAction', { count: action.length })}
            </TabsTrigger>
            <TabsTrigger dense value="all">
              {t('all')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="action">{list(action)}</TabsContent>
          <TabsContent value="all">{list(items)}</TabsContent>
        </Tabs>
        <div className="flex flex-col px-5 py-3 shadow-hairline-t">
          <Link
            href="/settings/notifications"
            className="text-table font-semibold text-fg-1"
            onClick={() => setOpen(false)}
          >
            {t('settings')}
          </Link>
          <span className="text-meta text-fg-2">{t('channels')}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
