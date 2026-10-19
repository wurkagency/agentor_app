'use client';

import { Button, Dialog, Field, Icon, Switch, Textarea, toast } from '@agentor/ui';
import { Eye, MessageCircle, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  addCustomerNoteAction,
  endAccessAction,
  openAsSuperadminAction,
  openSupportViewAction,
  requestExtensionAction,
} from '@/app/platform/actions';
import { RequestAccessDialog, type AccessTarget } from './request-access-dialog';

/** "Åbn kundens app" (P2): starts the support view under the active grant. */
export function OpenAppButton({ grantId, size = 'l' }: { grantId: string; size?: 'l' | 's' }) {
  const t = useTranslations('platform.customer');
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size={size}
      loading={pending}
      onClick={() => start(async () => void (await openSupportViewAction(grantId)))}
    >
      {!pending && <Icon icon={Eye} size={16} />}
      {size === 'l' ? t('openApp') : t('openAppShort')}
    </Button>
  );
}

/** Superadmin: "Åbn kundens app" without a request; it shows in the audit log only. */
export function OpenDirectButton({ tenantId, size = 'l' }: { tenantId: string; size?: 'l' | 's' }) {
  const t = useTranslations('platform.customer');
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size={size}
      loading={pending}
      onClick={() => start(async () => void (await openAsSuperadminAction(tenantId)))}
    >
      {!pending && <Icon icon={Eye} size={size === 'l' ? 16 : 14} />}
      {size === 'l' ? t('openApp') : t('openAppShort')}
    </Button>
  );
}

export function RequestAccessButton({
  target,
  variant = 'primary',
  defaultCaseId,
}: {
  target: AccessTarget;
  variant?: 'primary' | 'secondary';
  defaultCaseId?: string;
}) {
  const t = useTranslations('platform.customers');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={variant === 'primary' ? 'l' : 's'}
        onClick={() => setOpen(true)}
      >
        <Icon icon={Plus} size={16} />
        {t('requestAccess')}
      </Button>
      {open && (
        <RequestAccessDialog
          target={target}
          open
          onOpenChange={setOpen}
          defaultCaseId={defaultCaseId}
        />
      )}
    </>
  );
}

/** "Bed om forlængelse" and "Afslut adgang" in the grant banner (P2). */
export function GrantActions({ tenantId, grantId }: { tenantId: string; grantId: string }) {
  const t = useTranslations('platform.customer');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="s"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await requestExtensionAction(tenantId, grantId);
            if (res.ok) toast.ok({ title: t('extensionSent'), closeLabel: tc('close') });
          })
        }
      >
        {t('askExtension')}
      </Button>
      <Button
        variant="destructive"
        size="s"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await endAccessAction(tenantId, grantId);
            if (res.ok) {
              toast.ok({ title: t('accessEnded'), closeLabel: tc('close') });
              router.refresh();
            }
          })
        }
      >
        {t('endAccess')}
      </Button>
    </span>
  );
}

/** "Ny note" (P2): a staff note about the customer; pinned notes show on every case (S3). */
export function NoteButton({ tenantId }: { tenantId: string }) {
  const t = useTranslations('platform.customer');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(true);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" size="m" onClick={() => setOpen(true)}>
        <Icon icon={MessageCircle} size={16} />
        {t('newNote')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        width={560}
        title={t('newNote')}
        description={t('noteHelp')}
        closeLabel={tc('close')}
        footer={
          <span className="flex gap-2">
            <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!body.trim()}
              onClick={() =>
                start(async () => {
                  const res = await addCustomerNoteAction(tenantId, body, pinned);
                  if (res.ok) {
                    setOpen(false);
                    setBody('');
                    router.refresh();
                  }
                })
              }
            >
              {t('saveNote')}
            </Button>
          </span>
        }
      >
        <Field label={t('note')}>
          {({ id }) => (
            <Textarea id={id} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
        <label className="flex items-center justify-between gap-3 text-table">
          {t('pin')}
          <Switch checked={pinned} onCheckedChange={setPinned} aria-label={t('pin')} />
        </label>
      </Dialog>
    </>
  );
}
