'use client';

import { toast } from '@agentor/ui';
import {
  BigButton,
  CardActions,
  CardButton,
  MobileCallout,
  MobileField,
  MobileInput,
  Modal,
  Segmented,
  Switch,
  TopBarAction,
} from '@agentor/ui/mobile';
import { Plus, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { disableStaffAction, saveSettingsAction, upsertStaffAction } from '@/app/platform/actions';

const ERRORS = ['USER_NOT_FOUND', 'LAST_SUPERADMIN', 'NOT_SUPERADMIN'];
type Role = 'superadmin' | 'supporter';

function errorKey(code: string | undefined) {
  return `errors.${code && ERRORS.includes(code) ? code : 'generic'}`;
}

/** Two BigButtons under a modal (MP04 footer). */
function Footer({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-m-actions gap-2">{children}</div>;
}

function RoleSegmented({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  const t = useTranslations('platform.users');
  return (
    <Segmented
      label={t('role')}
      value={value}
      onChange={(k) => onChange(k as Role)}
      items={[
        { key: 'supporter', label: t('roles.supporter') },
        { key: 'superadmin', label: t('roles.superadmin') },
      ]}
    />
  );
}

/** MP12 "Invitér medarbejder" in the top bar: an existing Agentor login becomes staff. */
export function InviteStaffAction() {
  const t = useTranslations('platform.users');
  const tm = useTranslations('mobile.platformUsers');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('supporter');
  const [probation, setProbation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const save = () =>
    start(async () => {
      setError(null);
      const res = await upsertStaffAction({ email, role, probationUntil: probation || null });
      if (!res.ok) return setError(errorKey(res.error));
      close();
      setEmail('');
      setProbation('');
      toast.ok({ title: t('saved'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <TopBarAction icon={Plus} label={t('invite')} onNavy onClick={() => setOpen(true)} />
      <Modal
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        title={t('invite')}
        description={t('inviteHelp')}
        closeLabel={tc('close')}
        footer={
          <Footer>
            <BigButton variant="secondary" onClick={close}>
              {t('cancel')}
            </BigButton>
            <BigButton loading={pending} disabled={!email.includes('@')} onClick={save}>
              {tm('inviteSave')}
            </BigButton>
          </Footer>
        }
      >
        {error && <MobileCallout tone="error" icon={TriangleAlert} title={t(error)} />}
        <MobileField label={t('email')}>
          <MobileInput
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </MobileField>
        <div className="flex flex-col gap-1.5">
          <strong className="text-table">{t('role')}</strong>
          <RoleSegmented value={role} onChange={setRole} />
        </div>
        <MobileField label={t('probation')} hint={t('probationHelp')}>
          <MobileInput
            type="date"
            value={probation}
            onChange={(e) => setProbation(e.target.value)}
          />
        </MobileField>
      </Modal>
    </>
  );
}

/** "Skift rolle" and "Deaktivér" in a staff member's unfolded row (MP12). */
export function StaffActions({
  userId,
  name,
  email,
  role,
}: {
  userId: string;
  name: string;
  email: string;
  role: Role;
}) {
  const t = useTranslations('platform.users');
  const tm = useTranslations('mobile.platformUsers');
  const tc = useTranslations('common');
  const router = useRouter();
  const [modal, setModal] = useState<'role' | 'disable' | null>(null);
  const [next, setNext] = useState<Role>(role);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok)
        return void toast.error({ title: t(errorKey(res.error)), closeLabel: tc('close') });
      setModal(null);
      toast.ok({ title: t('saved'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <CardActions>
        <CardButton
          onClick={() => {
            setNext(role);
            setModal('role');
          }}
        >
          {tm('changeRole')}
        </CardButton>
        <CardButton variant="destructive" onClick={() => setModal('disable')}>
          {t('disable')}
        </CardButton>
      </CardActions>
      <Modal
        open={modal === 'role'}
        onOpenChange={(o) => !o && setModal(null)}
        title={tm('changeRole')}
        description={name}
        closeLabel={tc('close')}
        footer={
          <Footer>
            <BigButton variant="secondary" onClick={() => setModal(null)}>
              {t('cancel')}
            </BigButton>
            <BigButton
              loading={pending}
              disabled={next === role}
              onClick={() => run(() => upsertStaffAction({ email, role: next }))}
            >
              {t('save')}
            </BigButton>
          </Footer>
        }
      >
        <RoleSegmented value={next} onChange={setNext} />
        <p className="m-0 text-meta font-medium text-fg-2">
          {next === 'superadmin' ? t('accessAll') : t('accessSupport')}
        </p>
      </Modal>
      <Modal
        open={modal === 'disable'}
        onOpenChange={(o) => !o && setModal(null)}
        title={tm('disableTitle', { name })}
        closeLabel={tc('close')}
        footer={
          <Footer>
            <BigButton variant="secondary" onClick={() => setModal(null)}>
              {t('cancel')}
            </BigButton>
            <BigButton
              variant="destructive"
              loading={pending}
              onClick={() => run(() => disableStaffAction(userId))}
            >
              {t('disable')}
            </BigButton>
          </Footer>
        }
      >
        <p className="m-0 text-body">{tm('disableBody')}</p>
      </Modal>
    </>
  );
}

/** "Advar ved" for the access rules (MP12); duration and case-and-reason are fixed (§9.7). */
export function RulesEdit({ warnConcurrent }: { warnConcurrent: number }) {
  const t = useTranslations('platform.users');
  const tm = useTranslations('mobile.platformUsers');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warn, setWarn] = useState(warnConcurrent > 0);
  const [count, setCount] = useState(String(warnConcurrent || 3));
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveSettingsAction({
        warnConcurrentGrants: warn ? Math.min(49, Math.max(1, Number(count) || 3)) : 50,
        requireCaseAndReason: true,
      });
      toast[res.ok ? 'ok' : 'error']({
        title: res.ok ? t('saved') : t('errors.generic'),
        closeLabel: tc('close'),
      });
      if (res.ok) setOpen(false);
      router.refresh();
    });
  return (
    <>
      <CardActions>
        <CardButton onClick={() => setOpen(true)}>{tm('editRules')}</CardButton>
      </CardActions>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('rulesTitle')}
        description={t('approvalAlways')}
        closeLabel={tc('close')}
        footer={
          <Footer>
            <BigButton variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </BigButton>
            <BigButton loading={pending} onClick={save}>
              {t('save')}
            </BigButton>
          </Footer>
        }
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-body">{t('warnConcurrent')}</strong>
          <Switch checked={warn} onCheckedChange={setWarn} label={t('warnConcurrent')} />
        </div>
        {warn && (
          <MobileField label={tm('warnCount')}>
            <MobileInput
              inputMode="numeric"
              className="tabular"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </MobileField>
        )}
      </Modal>
    </>
  );
}
