'use client';

import { Banner, Button, Field, Input } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

/** Always shows the same confirmation, so the form never reveals whether an e-mail exists. */
export function ForgotForm() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      redirectTo: '/reset-password',
    });
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <Banner tone="info">{t('forgotSent')}</Banner>
        <Link href="/login" className="text-table font-semibold text-fg-1">
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <Field label={t('email')}>
        {({ id }) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="l" className="w-full" loading={busy}>
        {busy ? t('forgotSending') : t('forgotSend')}
      </Button>
      <Link href="/login" className="text-table text-fg-2">
        {t('backToLogin')}
      </Link>
    </form>
  );
}
