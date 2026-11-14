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
  Select,
  Switch,
  toast,
} from '@agentor/ui';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { disableStaffAction, saveSettingsAction, upsertStaffAction } from '@/app/platform/actions';

const ERRORS = ['USER_NOT_FOUND', 'LAST_SUPERADMIN', 'NOT_SUPERADMIN'];

/** "Invitér medarbejder" (P6): an existing Agentor login becomes staff with a role. */
export function InviteStaffButton() {
  const t = useTranslations('platform.users');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('supporter');
  const [probation, setProbation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="primary" size="l" onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('invite')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        width={560}
        title={t('invite')}
        description={t('inviteHelp')}
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
              disabled={!email.includes('@')}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await upsertStaffAction({
                    email,
                    role,
                    probationUntil: probation || null,
                  });
                  if (!res.ok) return setError(ERRORS.includes(res.error) ? res.error : 'generic');
                  setOpen(false);
                  setEmail('');
                  toast.ok({ title: t('saved'), closeLabel: tc('close') });
                  router.refresh();
                })
              }
            >
              {t('save')}
            </Button>
          </span>
        }
      >
        {error && <Banner tone="error">{t(`errors.${error}`)}</Banner>}
        <Field label={t('email')}>
          {({ id }) => (
            <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label={t('role')} inline>
          {({ id }) => (
            <Select
              id={id}
              value={role}
              onValueChange={setRole}
              options={[
                { value: 'supporter', label: t('roles.supporter') },
                { value: 'superadmin', label: t('roles.superadmin') },
              ]}
            />
          )}
        </Field>
        <Field label={t('probation')} help={t('probationHelp')} inline>
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="date"
              value={probation}
              onChange={(e) => setProbation(e.target.value)}
              className="h-10 rounded-sm border-0 bg-surface px-3 font-sans text-table text-fg-1 shadow-ring-chip"
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}

export function StaffRowMenu({
  userId,
  email,
  role,
  self,
}: {
  userId: string;
  email: string;
  role: string;
  self: boolean;
}) {
  const t = useTranslations('platform.users');
  const tc = useTranslations('common');
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok)
        toast.error({
          title: t(`errors.${res.error && ERRORS.includes(res.error) ? res.error : 'generic'}`),
          closeLabel: tc('close'),
        });
      router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('menu', { email })}>
          <Icon icon={MoreHorizontal} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            run(() =>
              upsertStaffAction({
                email,
                role: role === 'superadmin' ? 'supporter' : 'superadmin',
              }),
            )
          }
        >
          {role === 'superadmin' ? t('makeSupporter') : t('makeSuperadmin')}
        </DropdownMenuItem>
        {!self && (
          <DropdownMenuItem destructive onSelect={() => run(() => disableStaffAction(userId))}>
            {t('disable')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Regler for supportadgang (P6) and the hourly rate for billable time (Platformindstillinger). */
export function RulesForm({
  warnConcurrent,
  bookkeeperEmail = null,
}: {
  warnConcurrent: number;
  bookkeeperEmail?: string | null;
}) {
  const t = useTranslations('platform.users');
  const tc = useTranslations('common');
  const router = useRouter();
  const [warn, setWarn] = useState(warnConcurrent > 0);
  const [count, setCount] = useState(String(warnConcurrent || 3));
  const [bookkeeper, setBookkeeper] = useState(bookkeeperEmail ?? '');
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveSettingsAction({
        warnConcurrentGrants: warn ? Math.max(1, Number(count) || 3) : 50,
        requireCaseAndReason: true,
        bookkeeperEmail: bookkeeper.trim() || null,
      });
      toast[res.ok ? 'ok' : 'error']({
        title: res.ok ? t('saved') : t('errors.generic'),
        closeLabel: tc('close'),
      });
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 text-table">
        <span className="font-medium">{t('maxDuration')}</span>
        <span className="rounded-sm px-3 py-2 shadow-ring-chip">{t('hours24')}</span>
      </div>
      <label className="flex items-center justify-between gap-3 text-table font-medium">
        {t('requireCase')}
        <Switch checked disabled aria-label={t('requireCase')} />
      </label>
      <label className="flex items-center justify-between gap-3 text-table font-medium">
        <span className="flex items-center gap-2">
          {t('warnConcurrent')}
          {warn && (
            <Input
              aria-label={t('warnCount')}
              className="w-16 tabular"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          )}
        </span>
        <Switch checked={warn} onCheckedChange={setWarn} aria-label={t('warnConcurrent')} />
      </label>
      {
        <Field label={t('bookkeeper')} help={t('bookkeeperHelp')} inline>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="email"
              aria-describedby={describedBy}
              className="w-72"
              value={bookkeeper}
              onChange={(e) => setBookkeeper(e.target.value)}
            />
          )}
        </Field>
      }
      <p className="m-0 text-meta text-fg-2">{t('approvalAlways')}</p>
      <div>
        <Button variant="primary" size="m" loading={pending} onClick={save}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
