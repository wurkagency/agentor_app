'use client';

import {
  Banner,
  Button,
  Dialog,
  Field,
  Icon,
  Input,
  ProfileCard,
  ProfileRow,
  StatusPill,
  Switch,
  toast,
} from '@agentor/ui';
import { formatDate, type Locale } from '@agentor/i18n';
import { Fingerprint, KeyRound, Laptop, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { forgetDevice } from '@/components/mobile/pwa';
import { logoutOthersAction } from '@/server/profile/actions';
import type { ProfileView } from '@/server/profile/view';

type Security = ProfileView['security'];

/**
 * Login og sikkerhed (PR1, D15, MP29, MA36): password, two-step login, recovery codes, passkeys,
 * sessions and the login e-mail. Better Auth does the work and checks the password where it
 * matters; the server writes each change to the audit log.
 */
export function useSecurity(kind: 'staff' | 'customer') {
  const t = useTranslations('profile.security');
  const tc = useTranslations('common');
  const router = useRouter();
  const [dialog, setDialog] = useState<null | 'password' | 'disable2fa' | 'codes' | 'email'>(null);
  const [pending, start] = useTransition();
  const done = (title: string) => {
    toast.ok({ title, closeLabel: tc('close') });
    router.refresh();
  };
  const addPasskey = () =>
    start(async () => {
      const r = await authClient.passkey.addPasskey({ name: navigator.platform || 'Passkey' });
      if (r?.error) toast.error({ title: t('passkeyError'), closeLabel: tc('close') });
      else done(t('passkeyAdded'));
    });
  const removePasskey = (id: string) =>
    start(async () => {
      const r = await authClient.passkey.deletePasskey({ id });
      if (r?.error) toast.error({ title: t('error'), closeLabel: tc('close') });
      else done(t('passkeyRemoved'));
    });
  const logoutOthers = () =>
    start(async () => {
      const r = await logoutOthersAction(kind);
      if (r.ok) done(t('loggedOutOthers', { count: r.data!.count }));
    });
  return { dialog, setDialog, pending, addPasskey, removePasskey, logoutOthers, done };
}

export function SecurityCard({ kind, s }: { kind: 'staff' | 'customer'; s: Security }) {
  const t = useTranslations('profile.security');
  const locale = useLocale() as Locale;
  const sec = useSecurity(kind);
  const strong = s.twoFactorEnabled && (s.passkeys.length > 0 || s.hasPassword);
  const others = s.sessions.filter((x) => !x.current).length;
  return (
    <ProfileCard
      id="sikkerhed"
      title={t('heading')}
      meta={
        <StatusPill status={strong ? 'ok' : 'warn'} compact>
          {strong ? t('strong') : t('weak')}
        </StatusPill>
      }
    >
      <div>
        <ProfileRow
          icon={KeyRound}
          title={t('password')}
          meta={
            s.passwordChangedAt
              ? t('passwordChanged', { date: formatDate(new Date(s.passwordChangedAt), locale) })
              : t('noPassword')
          }
          action={
            s.hasPassword ? (
              <Button variant="secondary" size="s" onClick={() => sec.setDialog('password')}>
                {t('changePassword')}
              </Button>
            ) : undefined
          }
        />
        <ProfileRow
          icon={ShieldCheck}
          title={t('twoFactor')}
          meta={
            s.twoFactorEnabled
              ? s.mustKeepTwoFactor
                ? t('twoFactorRequired')
                : t('twoFactorOn')
              : t('twoFactorOff')
          }
          action={
            <span className="flex items-center gap-2.5">
              {s.twoFactorEnabled && (
                <Button variant="secondary" size="s" onClick={() => sec.setDialog('codes')}>
                  {t('newCodes')}
                </Button>
              )}
              <Switch
                aria-label={t('twoFactor')}
                checked={s.twoFactorEnabled}
                disabled={s.twoFactorEnabled && s.mustKeepTwoFactor}
                onCheckedChange={(on) => {
                  if (on) window.location.assign('/login/mfa/setup');
                  else sec.setDialog('disable2fa');
                }}
              />
            </span>
          }
        />
        <ProfileRow
          icon={Fingerprint}
          title={t('passkeys')}
          meta={
            s.passkeys.length ? (
              <span className="flex flex-wrap gap-x-1.5">
                {s.passkeys.map((p, i) => (
                  <span key={p.id} className="inline-flex items-center gap-1">
                    {i > 0 && <span aria-hidden>·</span>}
                    {p.name || t('passkey')}
                    <button
                      type="button"
                      onClick={() => sec.removePasskey(p.id)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-sans text-meta text-fg-1 underline"
                      aria-label={t('removePasskey', { name: p.name || t('passkey') })}
                    >
                      {t('remove')}
                    </button>
                  </span>
                ))}
              </span>
            ) : (
              t('noPasskeys')
            )
          }
          action={
            <Button variant="secondary" size="s" loading={sec.pending} onClick={sec.addPasskey}>
              {t('addPasskey')}
            </Button>
          }
        />
        <ProfileRow
          icon={Laptop}
          title={t('sessions')}
          meta={s.sessions
            .map((x) => (x.current ? t('thisDevice', { label: x.label }) : x.label))
            .join(' · ')}
          action={
            <Button
              variant="secondary"
              size="s"
              disabled={others === 0}
              loading={sec.pending}
              onClick={sec.logoutOthers}
            >
              {t('logoutOthers')}
            </Button>
          }
        />
        <ProfileRow
          icon={Mail}
          title={t('loginEmail')}
          meta={`${s.email} · ${s.emailVerified ? t('verified') : t('unverified')}`}
          action={
            <Button variant="secondary" size="s" onClick={() => sec.setDialog('email')}>
              {t('changeEmail')}
            </Button>
          }
        />
      </div>
      <SecurityDialogs sec={sec} email={s.email} />
    </ProfileCard>
  );
}

/** The dialogs behind the security rows (shared by desktop and mobile). */
export function SecurityDialogs({
  sec,
  email,
}: {
  sec: ReturnType<typeof useSecurity>;
  email: string;
}) {
  const close = () => sec.setDialog(null);
  return (
    <>
      {sec.dialog === 'password' && <PasswordDialog onClose={close} onDone={sec.done} />}
      {sec.dialog === 'disable2fa' && <DisableTwoFactorDialog onClose={close} onDone={sec.done} />}
      {sec.dialog === 'codes' && <CodesDialog onClose={close} />}
      {sec.dialog === 'email' && <EmailDialog current={email} onClose={close} onDone={sec.done} />}
    </>
  );
}

function SimpleDialog({
  title,
  description,
  onClose,
  footer,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={480}
      title={title}
      {...(description ? { description } : {})}
      closeLabel={tc('close')}
      footer={<div className="flex w-full justify-end gap-2">{footer}</div>}
    >
      {children}
    </Dialog>
  );
}

function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const t = useTranslations('profile.security');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [others, setOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tooShort = next.length > 0 && next.length < 12;
  return (
    <SimpleDialog
      title={t('changePassword')}
      description={t('changePasswordHelp')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            loading={pending}
            disabled={!current || next.length < 12}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await authClient.changePassword({
                  currentPassword: current,
                  newPassword: next,
                  revokeOtherSessions: others,
                });
                if (r.error) return setError(t('passwordError'));
                onClose();
                onDone(t('passwordSaved'));
              })
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <Field label={t('currentPassword')}>
        {({ id }) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('newPassword')}
        {...(tooShort ? { error: t('passwordTooShort') } : { help: t('passwordHelp') })}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            aria-describedby={describedBy}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <label className="flex items-center justify-between gap-3 text-table font-medium">
        {t('logoutOthersToo')}
        <Switch checked={others} onCheckedChange={setOthers} aria-label={t('logoutOthersToo')} />
      </label>
    </SimpleDialog>
  );
}

function DisableTwoFactorDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const t = useTranslations('profile.security');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <SimpleDialog
      title={t('disableTwoFactor')}
      description={t('disableTwoFactorHelp')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            size="m"
            loading={pending}
            disabled={!password}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await authClient.twoFactor.disable({ password });
                if (r.error)
                  return setError(
                    r.error.code === 'TWO_FACTOR_REQUIRED'
                      ? t('twoFactorRequired')
                      : t('passwordError'),
                  );
                onClose();
                onDone(t('twoFactorDisabled'));
              })
            }
          >
            {t('disable')}
          </Button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <Field label={t('currentPassword')}>
        {({ id }) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
    </SimpleDialog>
  );
}

function CodesDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('profile.security');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  return (
    <SimpleDialog
      title={t('newCodes')}
      description={codes ? t('codesSave') : t('codesHelp')}
      onClose={onClose}
      footer={
        codes ? (
          <Button variant="primary" size="m" onClick={onClose}>
            {t('codesDone')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="m"
            loading={pending}
            disabled={!password}
            onClick={() =>
              start(async () => {
                const r = await authClient.twoFactor.generateBackupCodes({ password });
                if (r.error || !r.data) setError(true);
                else setCodes(r.data.backupCodes);
              })
            }
          >
            {t('makeCodes')}
          </Button>
        )
      }
    >
      {error && <Banner tone="error">{t('passwordError')}</Banner>}
      {codes ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-mono">
          {codes.map((c) => (
            <li key={c} className="rounded-sm bg-bg-base px-3 py-2">
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <Field label={t('currentPassword')}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
      )}
    </SimpleDialog>
  );
}

function EmailDialog({
  current,
  onClose,
  onDone,
}: {
  current: string;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const t = useTranslations('profile.security');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <SimpleDialog
      title={t('changeEmail')}
      description={sent ? t('emailCodeSent', { email }) : t('emailHelp', { email: current })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          {sent ? (
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={code.length !== 6}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await authClient.emailOtp.changeEmail({ newEmail: email, otp: code });
                  if (r.error) return setError(t('emailCodeError'));
                  onClose();
                  onDone(t('emailChanged'));
                })
              }
            >
              {t('confirm')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!/^\S+@\S+\.\S+$/.test(email)}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await authClient.emailOtp.requestEmailChange({ newEmail: email });
                  if (r.error)
                    return setError(
                      r.error.status === 403 || /fresh|sensitive/i.test(r.error.message ?? '')
                        ? t('emailFresh')
                        : t('emailError'),
                    );
                  setSent(true);
                })
              }
            >
              {t('sendCode')}
            </Button>
          )}
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {sent ? (
        <Field label={t('emailCode')}>
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
      ) : (
        <Field label={t('newEmail')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
            />
          )}
        </Field>
      )}
    </SimpleDialog>
  );
}

/** "Log ud" on this device (PR1, D15, MP29, MA36). */
export function LogoutCard({ kind }: { kind: 'staff' | 'customer' }) {
  const t = useTranslations('profile');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-wrap items-center gap-3.5 rounded-lg bg-surface px-6 py-5 shadow-sm">
      <span className="grid size-10 flex-none place-items-center rounded-node bg-error-bg text-error-fg">
        <Icon icon={LogOut} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <strong>{t('logout.title')}</strong>
        <span className="text-meta text-fg-2">{t('logout.help')}</span>
      </span>
      <Button
        // PR1 draws the button red, D15 as a plain text button.
        variant={kind === 'staff' ? 'destructive' : 'ghost'}
        size="m"
        loading={pending}
        onClick={() =>
          start(async () => {
            await forgetDevice();
            await authClient.signOut();
            router.replace('/login');
            router.refresh();
          })
        }
      >
        {!pending && <Icon icon={LogOut} size={16} />}
        {t('logout.button')}
      </Button>
    </section>
  );
}
