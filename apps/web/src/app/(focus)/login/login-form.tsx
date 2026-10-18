'use client';

import { Banner, Button, Field, Input } from '@agentor/ui';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { syncLocale } from '@/app/actions/session';

type ErrorKey = 'invalid' | 'locked' | 'rateLimited' | 'passkey' | 'generic';

/** Maps Better Auth errors to plain Danish: what happened and what to do (§9.2). */
function toErrorKey(
  error:
    | { status?: number | undefined; code?: string | undefined; message?: string | undefined }
    | null
    | undefined,
): ErrorKey {
  if (!error) return 'generic';
  if (error.code === 'ACCOUNT_LOCKED' || error.message === 'ACCOUNT_LOCKED') return 'locked';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 401 || error.status === 403 || error.code === 'INVALID_EMAIL_OR_PASSWORD')
    return 'invalid';
  return 'generic';
}

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('password');
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
    router.replace('/');
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
    router.replace('/');
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {error && <Banner tone="error">{t(`errors.${error}`)}</Banner>}
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
          <label htmlFor="password" className="text-table font-medium">
            {t('password')}
          </label>
          <Link href="/forgot-password" className="text-table font-semibold text-fg-1">
            {t('forgot')}
          </Link>
        </div>
        <Input
          id="password"
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
      <p className="m-0 text-center text-table font-medium text-fg-2">
        {t('newHere')}{' '}
        <a href="https://agentor.dk/opret" className="font-semibold text-fg-1">
          {t('createAccount')}
        </a>
      </p>
    </form>
  );
}
