'use client';

import { Banner, Button, Field, Input, LockedValue } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { acceptInvite, createAccountAndAccept } from './actions';

const KNOWN = ['INVITATION_CLOSED', 'EXISTS'] as const;

function useInviteError() {
  const t = useTranslations('inviteAccept');
  return (code: string) =>
    code === 'EXISTS'
      ? t('errors.EXISTS')
      : code === 'INVITATION_CLOSED'
        ? t('closed')
        : t('errors.generic');
}

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('inviteAccept');
  const router = useRouter();
  const describe = useInviteError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error && <Banner tone="error">{describe(error)}</Banner>}
      <Button
        variant="primary"
        size="l"
        className="w-full"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await acceptInvite(token);
            if (r.ok) {
              router.replace('/');
              router.refresh();
            } else setError(r.error);
          })
        }
      >
        {pending ? t('accepting') : t('accept')}
      </Button>
    </>
  );
}

export function CreateAccount({ token, email }: { token: string; email: string }) {
  const t = useTranslations('inviteAccept');
  const auth = useTranslations('auth');
  const router = useRouter();
  const describe = useInviteError();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      const r = await createAccountAndAccept({ token, name, password });
      if (r.ok) {
        // Created and accepted; if signing in failed, the login page finishes it.
        router.replace(r.data?.signedIn === false ? '/login' : '/');
        router.refresh();
      } else setError(KNOWN.includes(r.error as (typeof KNOWN)[number]) ? r.error : 'generic');
    });
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      {error && <Banner tone="error">{describe(error)}</Banner>}
      <Field label={auth('email')}>{() => <LockedValue>{email}</LockedValue>}</Field>
      <Field label={t('name')}>
        {({ id }) => (
          <Input
            id={id}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('password')} help={t('passwordHelp')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="primary"
        size="l"
        className="w-full"
        loading={pending}
        disabled={name.trim().length < 2 || password.length < 12}
      >
        {pending ? t('creating') : t('create')}
      </Button>
    </form>
  );
}

export function LogoutButton() {
  const t = useTranslations('inviteAccept');
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await authClient.signOut();
        router.refresh();
      }}
    >
      {t('logout')}
    </Button>
  );
}
