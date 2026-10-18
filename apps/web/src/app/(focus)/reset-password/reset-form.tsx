'use client';

import { Banner, Button, Field, Input } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'done' | 'invalid'>('idle');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    setState(res.error ? 'invalid' : 'done');
  }

  if (state !== 'idle') {
    return (
      <div className="flex flex-col gap-5">
        <Banner tone={state === 'done' ? 'info' : 'error'}>
          {state === 'done' ? t('resetDone') : t('resetInvalid')}
        </Banner>
        <Link href="/login" className="text-table font-semibold text-fg-1">
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <Field label={t('resetNew')} help={t('resetHelp')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
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
        loading={busy}
        disabled={password.length < 12}
      >
        {t('resetSave')}
      </Button>
    </form>
  );
}
