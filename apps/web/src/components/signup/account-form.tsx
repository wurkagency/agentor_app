'use client';

import { Banner } from '@agentor/ui';
import {
  LogoRow,
  OrDivider,
  SignupButton,
  SignupHeading,
  SignupInput,
  SsoButton,
  TrustRow,
  type LogoRef,
  type TrustPoint,
} from '@agentor/ui/signup';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { startEmailSignup, startSso } from '@/app/(signup)/actions';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string | undefined>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SU1 / MS1: Google, Microsoft or name, e-mail and password. */
export function AccountForm({
  mobile = false,
  ssoEnabled,
  initialError,
  logoRow,
  more,
  points,
}: {
  mobile?: boolean;
  ssoEnabled: boolean;
  initialError?: string | undefined;
  /** MS1's logo row. */
  logoRow?: LogoRef[];
  more?: string;
  points?: TrustPoint[];
}) {
  const t = useTranslations('signupFlow.account');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Errors>(initialError ? { form: initialError } : {});
  const [pending, start] = useTransition();
  const [sso, setSso] = useState<'google' | 'microsoft' | null>(null);

  const check = (field: keyof typeof values, v = values[field]) => {
    if (field === 'name') return v.trim().length < 2 ? t('errors.name') : undefined;
    if (field === 'email') return EMAIL.test(v.trim()) ? undefined : t('errors.email');
    return v.length < 12 ? t('errors.password') : undefined;
  };

  const blur = (field: keyof typeof values) => () =>
    setErrors((e) => ({ ...e, [field]: values[field] ? check(field) : undefined }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {
      name: check('name'),
      email: check('email'),
      password: check('password'),
    };
    setErrors(next);
    if (next.name || next.email || next.password) return;
    start(async () => {
      const r = await startEmailSignup(values);
      // Success redirects to /signup/verify.
      if (r && !r.ok)
        setErrors({ form: t(r.error === 'rateLimited' ? 'errors.rateLimited' : 'errors.invalid') });
    });
  };

  const goSso = (provider: 'google' | 'microsoft') => {
    setSso(provider);
    start(async () => {
      const r = await startSso({ provider, from: 'signup' });
      if (r.ok && r.data) window.location.assign(r.data.url);
      else {
        setSso(null);
        setErrors({
          form: t(
            r.ok ? 'errors.generic' : r.error === 'ssoOff' ? 'errors.ssoOff' : 'errors.ssoFailed',
          ),
        });
      }
    });
  };

  return (
    <>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={mobile ? t('leadMobile') : t('lead')}
      />
      {mobile && logoRow && <LogoRow logos={logoRow} more={more} />}
      {errors.form && <Banner tone="error">{errors.form}</Banner>}
      {ssoEnabled && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <SsoButton
              provider="google"
              mobile={mobile}
              logoUrl="/logos/google.svg"
              label={mobile ? t('googleShort') : t('google')}
              accessibleLabel={t('google')}
              loading={sso === 'google'}
              disabled={pending}
              onClick={() => goSso('google')}
            />
            <SsoButton
              provider="microsoft"
              mobile={mobile}
              logoUrl="/logos/microsoft.svg"
              label={mobile ? t('microsoftShort') : t('microsoft')}
              accessibleLabel={t('microsoft')}
              loading={sso === 'microsoft'}
              disabled={pending}
              onClick={() => goSso('microsoft')}
            />
          </div>
          <OrDivider>{t('or')}</OrDivider>
        </>
      )}
      <form
        noValidate
        onSubmit={submit}
        className={mobile ? 'flex flex-col gap-3' : 'flex flex-col gap-5'}
      >
        <SignupInput
          mobile={mobile}
          label={t('name')}
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          onBlur={blur('name')}
          error={errors.name}
        />
        <SignupInput
          mobile={mobile}
          label={t('email')}
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          onBlur={blur('email')}
          error={errors.email}
        />
        <SignupInput
          mobile={mobile}
          label={t('password')}
          name="password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          onBlur={blur('password')}
          error={errors.password}
          help={mobile ? undefined : t('passwordHelp')}
        />
        <SignupButton
          type="submit"
          mobile={mobile}
          loading={pending && !sso}
          disabled={pending}
          className={mobile ? 'mt-2 w-full' : 'w-full'}
        >
          {pending && !sso ? t('submitting') : t('submit')}
        </SignupButton>
      </form>
      {mobile && points && <TrustRow points={points} />}
    </>
  );
}
