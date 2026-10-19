'use client';

import { Banner, Button, Checkbox, Field, Input } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { signUp } from './actions';

export function SignupForm() {
  const t = useTranslations('signup');
  const ta = useTranslations('auth');
  const [form, setForm] = useState({ name: '', email: '', password: '', terms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.terms) {
      setError('terms');
      return;
    }
    setBusy(true);
    const res = await signUp(form);
    setBusy(false);
    if (res.ok) setSentTo(form.email.trim().toLowerCase());
    else setError(res.error);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-5">
        <Banner tone="info">{t('sent', { email: sentTo })}</Banner>
        <Link href="/login" className="text-table font-semibold text-fg-1">
          {ta('backToLogin')}
        </Link>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {error && (
        <Banner tone="error">
          {t(`errors.${error === 'terms' || error === 'rateLimited' ? error : 'invalid'}`)}
        </Banner>
      )}
      <Field label={t('name')}>
        {({ id }) => (
          <Input id={id} autoComplete="name" required value={form.name} onChange={set('name')} />
        )}
      </Field>
      <Field label={ta('email')}>
        {({ id }) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
        )}
      </Field>
      <Field label={ta('password')} help={ta('resetHelp')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            aria-describedby={describedBy}
            value={form.password}
            onChange={set('password')}
          />
        )}
      </Field>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="signup-terms"
          checked={form.terms}
          onCheckedChange={(v) => setForm((f) => ({ ...f, terms: v === true }))}
        />
        <label htmlFor="signup-terms" className="text-table text-fg-1">
          {t.rich('terms', {
            link: (chunks) => (
              <a href="https://agentor.dk/vilkaar" className="font-semibold text-fg-1 underline">
                {chunks}
              </a>
            ),
          })}
        </label>
      </div>
      <Button type="submit" variant="primary" size="l" className="w-full" loading={busy}>
        {busy ? t('creating') : t('create')}
      </Button>
      <p className="text-table text-fg-2">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-semibold text-fg-1">
          {ta('login')}
        </Link>
      </p>
    </form>
  );
}
