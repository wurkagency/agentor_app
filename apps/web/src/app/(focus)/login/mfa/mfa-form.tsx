'use client';

import { Banner, Button, Checkbox, Field, Input, cn } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { syncLocale } from '@/app/actions/session';
import { takeNext } from '@/lib/safe-next';

const LENGTH = 6;

/** Second factor (D14-MFA): six digit boxes, "Husk denne enhed i 30 dage", backup code. */
export function MfaForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'codeInvalid' | 'rateLimited' | 'generic' | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setDigit(i: number, value: string) {
    const v = value.replace(/\D/g, '');
    if (v.length > 1) return fill(v, i);
    setDigits((d) => d.map((x, j) => (j === i ? v : x)));
    if (v && i < LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function fill(value: string, from = 0) {
    const chars = value
      .replace(/\D/g, '')
      .slice(0, LENGTH - from)
      .split('');
    setDigits((d) =>
      d.map((x, j) => (j >= from && j - from < chars.length ? chars[j - from]! : x)),
    );
    refs.current[Math.min(from + chars.length, LENGTH - 1)]?.focus();
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    fill(e.clipboardData.getData('text'));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = backupMode
      ? await authClient.twoFactor.verifyBackupCode({ code: backupCode.trim(), trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: digits.join(''), trustDevice: trust });
    if (res.error) {
      setBusy(false);
      // 429 is the per-IP rate limit (5 codes a minute), not an account lockout.
      setError(res.error.status === 429 ? 'rateLimited' : 'codeInvalid');
      setDigits(Array(LENGTH).fill(''));
      refs.current[0]?.focus();
      return;
    }
    await syncLocale();
    router.replace(takeNext());
    router.refresh();
  }

  const complete = backupMode ? backupCode.trim().length >= 8 : digits.every((d) => d !== '');

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {error && <Banner tone="error">{t(`errors.${error}`)}</Banner>}
      {backupMode ? (
        <Field label={t('backupLabel')} help={t('backupIntro')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoComplete="one-time-code"
              mono
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <fieldset className="m-0 flex justify-between gap-2 border-0 p-0">
          <legend className="sr-only">{t('mfaIntro')}</legend>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              aria-label={t('digit', { n: i + 1 })}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={LENGTH}
              value={d}
              autoFocus={i === 0}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={onPaste}
              className={cn(
                'box-border h-15 w-13 rounded-sm border border-border-strong bg-surface text-center font-sans text-stat-compact font-semibold text-fg-1',
                'focus-visible:border-fg-1',
              )}
            />
          ))}
        </fieldset>
      )}
      <label className="flex items-center gap-2.5 text-table">
        <Checkbox checked={trust} onCheckedChange={(v) => setTrust(v === true)} />
        {t('rememberDevice')}
      </label>
      <Button
        type="submit"
        variant="primary"
        size="l"
        className="w-full"
        loading={busy}
        disabled={!complete}
      >
        {busy ? t('confirming') : t('confirm')}
      </Button>
      <div className="flex justify-between text-table">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-fg-1 underline-offset-2 hover:underline"
          onClick={() => {
            setBackupMode((m) => !m);
            setError(null);
          }}
        >
          {backupMode ? t('useApp') : t('useBackup')}
        </button>
        <Link href="/login" className="text-fg-2">
          {t('back')}
        </Link>
      </div>
    </form>
  );
}
