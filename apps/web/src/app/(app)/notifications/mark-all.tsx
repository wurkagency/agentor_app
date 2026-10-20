'use client';

import { Button, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markAllNotificationsRead } from '@/app/actions/notifications';

/** "Marker alle læst" in the MA09 top bar: the same action the desktop popover uses. */
export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const t = useTranslations('mobile.notifications');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="s"
      disabled={disabled}
      loading={pending}
      className="touch-target"
      onClick={() =>
        start(async () => {
          await markAllNotificationsRead();
          toast.ok({ title: t('marked'), closeLabel: tc('close') });
          router.refresh();
        })
      }
    >
      {t('markAll')}
    </Button>
  );
}
