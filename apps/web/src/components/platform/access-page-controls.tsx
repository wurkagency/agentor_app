'use client';

import { Button, Icon, toast } from '@agentor/ui';
import { ExternalLink, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  endAccessAction,
  openSupportViewAction,
  requestExtensionAction,
} from '@/app/platform/actions';
import { RequestAccessDialog, type AccessTarget } from './request-access-dialog';

/** "Anmod om adgang" on Support › Adgange (S9): the existing request flow (P3) with a customer. */
export function RequestAccessPicker({ targets }: { targets: AccessTarget[] }) {
  const t = useTranslations('platform.grants');
  const [open, setOpen] = useState(false);
  const first = targets[0];
  return (
    <>
      <Button variant="primary" size="m" disabled={!first} onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('request')}
      </Button>
      {open && first && (
        <RequestAccessDialog target={first} choices={targets} open onOpenChange={setOpen} />
      )}
    </>
  );
}

/**
 * The actions on one of the staff member's own grants (S9): open the support view, ask the
 * customer for more time, end it, or withdraw a request that is still waiting. Only the staff
 * member's own grants have actions; the database refuses anything else (0024).
 */
export function GrantRowActions({
  tenantId,
  grantId,
  state,
  extensionRequested,
}: {
  tenantId: string;
  grantId: string;
  state: 'active' | 'pending';
  extensionRequested: boolean;
}) {
  const t = useTranslations('platform.grants');
  const tcu = useTranslations('platform.customer');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const end = (title: string) =>
    start(async () => {
      const res = await endAccessAction(tenantId, grantId);
      if (res.ok) {
        toast.ok({ title, closeLabel: tc('close') });
        router.refresh();
      }
    });
  if (state === 'pending')
    return (
      <Button variant="secondary" size="s" disabled={pending} onClick={() => end(t('withdraw'))}>
        {t('withdraw')}
      </Button>
    );
  return (
    <span className="flex justify-end gap-2">
      <Button
        variant="dark"
        size="s"
        loading={pending}
        onClick={() => start(async () => void (await openSupportViewAction(grantId)))}
      >
        {!pending && <Icon icon={ExternalLink} size={14} />}
        {t('openAsSupport')}
      </Button>
      <Button
        variant="secondary"
        size="s"
        disabled={pending || extensionRequested}
        onClick={() =>
          start(async () => {
            const res = await requestExtensionAction(tenantId, grantId);
            if (res.ok) {
              toast.ok({ title: tcu('extensionSent'), closeLabel: tc('close') });
              router.refresh();
            }
          })
        }
      >
        {extensionRequested ? t('extensionRequested') : t('extend')}
      </Button>
      <Button
        variant="destructive"
        size="s"
        disabled={pending}
        onClick={() => end(tcu('accessEnded'))}
      >
        {t('end')}
      </Button>
    </span>
  );
}
