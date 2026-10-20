'use client';

import { Button } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { authClient } from '@/lib/auth-client';
import { forgetDevice } from './pwa';

/** "Log ud" on MA10: clears the device's offline data and push subscription first (M3). */
export function LogoutButton() {
  const t = useTranslations('mobile.more');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      loading={pending}
      className="touch-target self-center text-error-fg"
      onClick={() =>
        start(async () => {
          await forgetDevice();
          await authClient.signOut();
          router.replace('/login');
          router.refresh();
        })
      }
    >
      {t('logout')}
    </Button>
  );
}
