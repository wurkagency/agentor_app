'use client';

import { Banner, Button, CopyButton, Field, Input } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

type Step =
  | { kind: 'password' }
  | { kind: 'scan'; uri: string; qr: string; secret: string; codes: string[] }
  | { kind: 'codes'; codes: string[] };

/**
 * TOTP enrolment for owners and admins (§9.5). No board exists; built from the D14 focus-card
 * pattern: confirm password → scan QR → verify a code → save backup codes.
 */
export function SetupFlow() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error || !res.data || res.data.method !== 'totp') {
      setError(res.error?.status === 429 ? t('errors.rateLimited') : t('errors.invalid'));
      return;
    }
    const uri = res.data.totpURI;
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 192 });
    setStep({ kind: 'scan', uri, qr, secret, codes: res.data.backupCodes });
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'scan') return;
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    setBusy(false);
    if (res.error) {
      setError(t('errors.codeInvalid'));
      return;
    }
    setStep({ kind: 'codes', codes: step.codes });
  }

  if (step.kind === 'password') {
    return (
      <form className="flex flex-col gap-5" onSubmit={start}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label={t('setupPassword')}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="l" className="w-full" loading={busy}>
          {t('setupStart')}
        </Button>
      </form>
    );
  }

  if (step.kind === 'scan') {
    return (
      <form className="flex flex-col gap-5" onSubmit={verify}>
        {error && <Banner tone="error">{error}</Banner>}
        <p className="m-0">{t('setupScan')}</p>
        {/* Data URL generated in the browser from the otpauth URI; nothing leaves the page. */}
        <img
          src={step.qr}
          alt=""
          width={192}
          height={192}
          className="self-center rounded-sm shadow-ring-border"
        />
        <div className="flex flex-col gap-1">
          <span className="text-table text-fg-2">{t('setupManual')}</span>
          <span className="flex items-center gap-1 break-all font-mono text-mono">
            {step.secret}
            <CopyButton value={step.secret} label={tc('copy')} copiedLabel={tc('copied')} />
          </span>
        </div>
        <Field label={t('setupCode')}>
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              mono
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="l"
          className="w-full"
          loading={busy}
          disabled={code.replace(/\D/g, '').length !== 6}
        >
          {t('setupVerify')}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Banner tone="warn" title={t('backupTitle')}>
        {t('backupSave')}
      </Banner>
      <ol
        className="m-0 grid grid-cols-2 gap-2 rounded-sm bg-bg-base p-4 pl-8 font-mono text-mono"
        aria-label={t('backupTitle')}
      >
        {step.codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <span className="flex items-center gap-2 text-table">
        <CopyButton
          value={step.codes.join('\n')}
          label={t('copyCodes')}
          copiedLabel={tc('copied')}
        />
        {t('copyCodes')}
      </span>
      <Button
        variant="primary"
        size="l"
        className="w-full"
        onClick={() => {
          router.replace('/');
          router.refresh();
        }}
      >
        {t('backupDone')}
      </Button>
    </div>
  );
}
