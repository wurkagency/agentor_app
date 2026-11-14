'use client';

import { Banner, Button, Field, Input } from '@agentor/ui';
import { SsoButton } from '@agentor/ui/signup';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { syncLocale } from '@/app/actions/session';
import { startSso } from '@/app/(signup)/actions';
import { rememberNext } from '@/lib/safe-next';

type ErrorKey = 'invalid' | 'locked' | 'rateLimited' | 'passkey' | 'unverified' | 'generic';

/** Maps Better Auth errors to plain Danish: what happened and what to do (§9.2). */
function toErrorKey(
  error:
    | { status?: number | undefined; code?: string | undefined; message?: string | undefined }
    | null
    | undefined,
): ErrorKey {
  if (!error) return 'generic';
  if (error.code === 'ACCOUNT_LOCKED' || error.message === 'ACCOUNT_LOCKED') return 'locked';
  // Only reported after a correct password: a new verification mail has been sent.
  if (error.code === 'EMAIL_NOT_VERIFIED') return 'unverified';
  if (error.status === 429) return 'rateLimited';
  // Only a real credential mismatch says "forkert"; a 403 (e.g. INVALID_ORIGIN) is a setup fault.
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') return 'invalid';
  return 'generic';
}

export function LoginForm({
  next = '/',
  ssoEnabled = false,
  ssoFailed = false,
}: {
  next?: string;
  /** Google and Microsoft (PLAN-SIGNUP B10). */
  ssoEnabled?: boolean;
  ssoFailed?: boolean;
}) {
  const t = useTranslations('auth');
  const ts = useTranslations('signupFlow.account');
  const router = useRouter();
  // Unique: the form can be on the page twice (desktop and the mobile MA01 fallback).
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'passkey' | 'google' | 'microsoft' | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [ssoError, setSsoError] = useState(ssoFailed);

  async function onSso(provider: 'google' | 'microsoft') {
    setError(null);
    setSsoError(false);
    setBusy(provider);
    rememberNext(next);
    const r = await startSso({ provider, from: 'login' });
    if (r.ok && r.data) {
      window.location.assign(r.data.url);
      return;
    }
    setBusy(null);
    setSsoError(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('password');
    rememberNext(next);
    const { data, error: err } = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err) {
      setBusy(null);
      setError(toErrorKey(err));
      return;
    }
    // With MFA enabled the client plugin redirects to /login/mfa; otherwise we're signed in.
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return;
    await syncLocale();
    router.replace(next);
    router.refresh();
  }

  async function onPasskey() {
    setError(null);
    setBusy('passkey');
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setBusy(null);
      setError('passkey');
      return;
    }
    await syncLocale();
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {error && <Banner tone="error">{t(`errors.${error}`)}</Banner>}
      {ssoError && <Banner tone="error">{ts('errors.ssoFailed')}</Banner>}
      <Field label={t('email')}>
        {({ id }) => (
          <Input
            id={id}
            type="email"
            name="email"
            autoComplete="username webauthn"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between">
          <label htmlFor={passwordId} className="text-table font-medium">
            {t('password')}
          </label>
          <Link href="/forgot-password" className="text-table font-semibold text-fg-1">
            {t('forgot')}
          </Link>
        </div>
        <Input
          id={passwordId}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        size="l"
        className="w-full"
        loading={busy === 'password'}
        disabled={busy !== null && busy !== 'password'}
      >
        {busy === 'password' ? t('loggingIn') : t('login')}
      </Button>
      <div className="flex items-center gap-3 text-meta font-medium text-fg-2">
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full"
        icon={KeyRound}
        loading={busy === 'passkey'}
        disabled={busy !== null && busy !== 'passkey'}
        onClick={() => void onPasskey()}
      >
        {t('passkey')}
      </Button>
      {ssoEnabled && (
        <div className="grid grid-cols-2 gap-2.5">
          {(['google', 'microsoft'] as const).map((p) => (
            <SsoButton
              key={p}
              provider={p}
              mobile
              logoUrl={`/logos/${p}.svg`}
              label={ts(p === 'google' ? 'googleShort' : 'microsoftShort')}
              accessibleLabel={ts(p)}
              loading={busy === p}
              disabled={busy !== null && busy !== p}
              onClick={() => void onSso(p)}
            />
          ))}
        </div>
      )}
      <p className="m-0 text-center text-table font-medium text-fg-2">
        {t('newHere')}{' '}
        <Link href="/signup" className="font-semibold text-fg-1">
          {t('createAccount')}
        </Link>
      </p>
    </form>
  );
}
