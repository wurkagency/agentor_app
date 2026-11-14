'use client';

import { Banner } from '@agentor/ui';
import { CodeInput, SignupButton, SignupHeading } from '@agentor/ui/signup';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, useTransition, type FormEvent } from 'react';
import { resendSignupCode, verifySignupCode } from '@/app/(signup)/actions';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** SU2 / MS2: the 6-digit code, with "send koden igen" after the countdown. */
export function VerifyForm({
  email,
  waitSeconds,
  mobile = false,
}: {
  email: string;
  waitSeconds: number;
  mobile?: boolean;
}) {
  const t = useTranslations('signupFlow.verify');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(waitSeconds);
  const [pending, start] = useTransition();
  const errId = useId();

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = (value: string) => {
    if (value.length !== 6) {
      setError(t('errors.codeInvalid'));
      return;
    }
    setError(null);
    start(async () => {
      const r = await verifySignupCode({ code: value });
      // Success redirects to /signup/company.
      if (r && !r.ok) {
        setError(t(r.error === 'rateLimited' ? 'errors.rateLimited' : 'errors.codeInvalid'));
        setCode('');
      }
    });
  };

  const resend = () =>
    start(async () => {
      const r = await resendSignupCode();
      if (r.ok) {
        setWait(r.data?.waitSeconds ?? 60);
        setNotice(t('resent'));
        setError(null);
      } else setError(t('errors.rateLimited'));
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify(code);
  };

  return (
    <form onSubmit={submit} noValidate className={mobile ? 'contents' : 'flex flex-col gap-5'}>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={t.rich('lead', { email, strong: (c) => <strong className="text-fg-1">{c}</strong> })}
        icon={
          mobile ? undefined : (
            <span className="grid size-14 place-items-center rounded-md bg-primary">
              <Mail aria-hidden size={24} />
            </span>
          )
        }
      />
      <CodeInput
        mobile={mobile}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={verify}
        label={t('code')}
        cellLabel={(i) => t('digit', { n: i + 1 })}
        error={!!error}
        disabled={pending}
        describedBy={error ? errId : undefined}
      />
      {error && (
        <p id={errId} role="alert" className="m-0 text-meta font-medium text-error-fg">
          {error}
        </p>
      )}
      {notice && !error && <Banner tone="info">{notice}</Banner>}
      <SignupButton type="submit" mobile={mobile} loading={pending} className="w-full">
        {pending ? t('submitting') : t('submit')}
      </SignupButton>
      <p
        className={mobile ? 'm-0 text-center text-meta text-fg-2' : 'm-0 text-meta text-fg-2'}
        aria-live="polite"
      >
        {wait > 0
          ? t('resendIn', { time: fmt(wait) })
          : t.rich('resendNow', {
              link: (c) => (
                <button
                  type="button"
                  onClick={resend}
                  disabled={pending}
                  className="cursor-pointer border-0 bg-transparent p-0 font-sans text-meta font-semibold text-fg-1 underline"
                >
                  {c}
                </button>
              ),
            })}
      </p>
    </form>
  );
}
