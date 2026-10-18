'use client';

import {
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@agentor/ui';
import { BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Notifications popover (D2-Notifikationer): 400 px, tabs "Kræver handling" and "Alle", footer
 * link to settings. Items arrive with notifications data in M6; M2 shows the empty state.
 */
export function NotificationsPopover({ trigger }: { trigger: ReactNode }) {
  const t = useTranslations('notificationsPanel');
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-100" aria-label={t('title')}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="m-0 text-card">{t('title')}</h2>
        </div>
        <Tabs defaultValue="action" className="px-5">
          <TabsList dense>
            <TabsTrigger dense value="action">
              {t('needsAction', { count: 0 })}
            </TabsTrigger>
            <TabsTrigger dense value="all">
              {t('all')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="action">
            <EmptyState icon={BellOff} title={t('emptyTitle')}>
              {t('emptyBody')}
            </EmptyState>
          </TabsContent>
          <TabsContent value="all">
            <EmptyState icon={BellOff} title={t('emptyTitle')}>
              {t('emptyBody')}
            </EmptyState>
          </TabsContent>
        </Tabs>
        <div className="px-5 py-3 shadow-hairline-t">
          <Link href="/settings/notifications" className="text-table font-semibold text-fg-1">
            {t('settings')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
