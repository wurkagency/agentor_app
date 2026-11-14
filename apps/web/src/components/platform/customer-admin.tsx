'use client';

import {
  Banner,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Icon,
  Input,
  Textarea,
  toast,
} from '@agentor/ui';
import { ChevronDown, CirclePause, CirclePlay, Mail, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteCustomerAction,
  resendOwnerInvitationAction,
  setCustomerStatusAction,
  updateCustomerAction,
} from '@/app/platform/customers/[id]/admin-actions';

export interface CustomerAdminProps {
  tenantId: string;
  status: 'active' | 'suspended' | 'deleting';
  name: string;
  cvr: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  billingEmail: string | null;
  invoices: number;
  hasOwner: boolean;
  ownerInvite: { email: string; expiresAt: string; open: boolean } | null;
}

type Open = null | 'edit' | 'invite' | 'suspend' | 'reactivate' | 'delete';

/**
 * "Administrér" on P2 (Superadmin): edit the company, send the owner a new invitation, suspend or
 * reactivate, and delete a customer that has never been invoiced. Each opens a dialog; the
 * destructive ones are confirmed there.
 */
export function CustomerAdmin(p: CustomerAdminProps) {
  const t = useTranslations('platform.customerAdmin');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [d, setD] = useState({
    name: p.name,
    cvr: p.cvr ?? '',
    addressLine: p.addressLine ?? '',
    postalCode: p.postalCode ?? '',
    city: p.city ?? '',
    billingEmail: p.billingEmail ?? '',
  });
  const [inviteEmail, setInviteEmail] = useState(p.ownerInvite?.email ?? '');
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');

  const show = (o: Open) => {
    setError(null);
    setOpen(o);
  };
  const errorText = (code: string) =>
    t.has(`error.${code}` as 'error.generic')
      ? t(`error.${code}` as 'error.generic')
      : t('error.generic');
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    after?: () => void,
  ) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(errorText(res.error ?? 'generic'));
        return;
      }
      setOpen(null);
      toast.ok({ title: done, closeLabel: tc('close') });
      if (after) after();
      else router.refresh();
    });

  const footer = (
    label: string,
    onClick: () => void,
    opts: { danger?: boolean; disabled?: boolean } = {},
  ) => (
    <span className="flex gap-2">
      <Button variant="secondary" size="m" onClick={() => setOpen(null)}>
        {tc('cancel')}
      </Button>
      <Button
        variant={opts.danger ? 'destructive' : 'primary'}
        size="m"
        loading={pending}
        disabled={opts.disabled}
        onClick={onClick}
      >
        {label}
      </Button>
    </span>
  );
  const field = (
    key: keyof typeof d,
    label: string,
    extra: { type?: string; autoComplete?: string } = {},
  ) => (
    <Field label={label}>
      {({ id }) => (
        <Input
          id={id}
          {...extra}
          value={d[key]}
          onChange={(e) => setD({ ...d, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const canDelete = p.invoices === 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="m">
            {t('menu')}
            <Icon icon={ChevronDown} size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5">
          <DropdownMenuItem icon={<Icon icon={Pencil} size={16} />} onSelect={() => show('edit')}>
            {t('edit')}
          </DropdownMenuItem>
          {!p.hasOwner && (
            <DropdownMenuItem icon={<Icon icon={Mail} size={16} />} onSelect={() => show('invite')}>
              {t('resend')}
            </DropdownMenuItem>
          )}
          {p.status === 'suspended' ? (
            <DropdownMenuItem
              icon={<Icon icon={CirclePlay} size={16} />}
              onSelect={() => show('reactivate')}
            >
              {t('reactivate')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              icon={<Icon icon={CirclePause} size={16} />}
              onSelect={() => show('suspend')}
            >
              {t('suspend')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon={<Icon icon={Trash2} size={16} />} onSelect={() => show('delete')}>
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open === 'edit'}
        onOpenChange={(o) => !o && setOpen(null)}
        width={560}
        title={t('editTitle')}
        closeLabel={tc('close')}
        footer={footer(t('save'), () => run(() => updateCustomerAction(p.tenantId, d), t('saved')))}
      >
        <div className="flex flex-col gap-4">
          {error && <Banner tone="error">{error}</Banner>}
          {field('name', t('name'), { autoComplete: 'organization' })}
          {field('cvr', t('cvr'))}
          {field('addressLine', t('address'), { autoComplete: 'street-address' })}
          <div className="grid grid-cols-form-row gap-3">
            {field('postalCode', t('postalCode'), { autoComplete: 'postal-code' })}
            {field('city', t('city'), { autoComplete: 'address-level2' })}
          </div>
          {field('billingEmail', t('billingEmail'), { type: 'email', autoComplete: 'email' })}
        </div>
      </Dialog>

      <Dialog
        open={open === 'invite'}
        onOpenChange={(o) => !o && setOpen(null)}
        width={560}
        title={t('resendTitle')}
        description={t('resendHelp')}
        closeLabel={tc('close')}
        footer={footer(t('resendButton'), () =>
          run(
            () => resendOwnerInvitationAction(p.tenantId, inviteEmail),
            t('resent', { email: inviteEmail }),
          ),
        )}
      >
        <div className="flex flex-col gap-4">
          {error && <Banner tone="error">{error}</Banner>}
          {p.ownerInvite && (
            <p className="m-0 text-table text-fg-2">
              {p.ownerInvite.open
                ? t('inviteOpen', { email: p.ownerInvite.email })
                : t('inviteClosed', { email: p.ownerInvite.email })}
            </p>
          )}
          <Field label={t('ownerEmail')}>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={open === 'suspend'}
        onOpenChange={(o) => !o && setOpen(null)}
        width={560}
        title={t('suspendTitle', { name: p.name })}
        description={t('suspendHelp')}
        closeLabel={tc('close')}
        footer={footer(
          t('suspendButton'),
          () => run(() => setCustomerStatusAction(p.tenantId, 'suspended', reason), t('suspended')),
          { danger: true, disabled: !reason.trim() },
        )}
      >
        <div className="flex flex-col gap-4">
          {error && <Banner tone="error">{error}</Banner>}
          <Field label={t('reason')} help={t('reasonHelp')}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={open === 'reactivate'}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t('reactivateTitle', { name: p.name })}
        description={t('reactivateHelp')}
        closeLabel={tc('close')}
        footer={footer(t('reactivate'), () =>
          run(() => setCustomerStatusAction(p.tenantId, 'active', ''), t('reactivated')),
        )}
      >
        {error ? <Banner tone="error">{error}</Banner> : null}
      </Dialog>

      <Dialog
        open={open === 'delete'}
        onOpenChange={(o) => !o && setOpen(null)}
        width={560}
        title={t('deleteTitle', { name: p.name })}
        description={canDelete ? t('deleteHelp') : t('deleteBlocked', { count: p.invoices })}
        closeLabel={tc('close')}
        footer={
          canDelete
            ? footer(
                t('deleteButton'),
                () =>
                  run(
                    () => deleteCustomerAction(p.tenantId, confirmName),
                    t('deleted', { name: p.name }),
                    () => router.replace('/platform/customers'),
                  ),
                {
                  danger: true,
                  disabled: confirmName.trim().toLowerCase() !== p.name.trim().toLowerCase(),
                },
              )
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          {error && <Banner tone="error">{error}</Banner>}
          {canDelete && (
            <Field label={t('confirmName', { name: p.name })}>
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="off"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      </Dialog>
    </>
  );
}
