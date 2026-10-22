'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { syncLocale } from '@/app/actions/session';
import { authClient } from '@/lib/auth-client';
import { takeNext } from '@/lib/safe-next';

export const MFA_LENGTH = 6;

/**
 * The second factor's state and behaviour (D14-MFA, MA34): six digit boxes with paste and arrow
 * keys, the backup code, "Husk denne enhed" and the verify call. Desktop and mobile only differ in
 * layout.
 */
export function useMfa() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(MFA_LENGTH).fill(''));
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'codeInvalid' | 'rateLimited' | 'generic' | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function fill(value: string, from = 0) {
    const chars = value
      .replace(/\D/g, '')
      .slice(0, MFA_LENGTH - from)
      .split('');
    setDigits((d) =>
      d.map((x, j) => (j >= from && j - from < chars.length ? chars[j - from]! : x)),
    );
    refs.current[Math.min(from + chars.length, MFA_LENGTH - 1)]?.focus();
  }

  function setDigit(i: number, value: string) {
    const v = value.replace(/\D/g, '');
    if (v.length > 1) return fill(v, i);
    setDigits((d) => d.map((x, j) => (j === i ? v : x)));
    if (v && i < MFA_LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < MFA_LENGTH - 1) refs.current[i + 1]?.focus();
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
      setDigits(Array(MFA_LENGTH).fill(''));
      refs.current[0]?.focus();
      return;
    }
    await syncLocale();
    router.replace(takeNext());
    router.refresh();
  }

  const complete = backupMode ? backupCode.trim().length >= 8 : digits.every((d) => d !== '');

  return {
    digits,
    backupMode,
    toggleBackup: () => {
      setBackupMode((m) => !m);
      setError(null);
    },
    backupCode,
    setBackupCode,
    trust,
    setTrust,
    busy,
    error,
    refs,
    setDigit,
    onKeyDown,
    onPaste,
    onSubmit,
    complete,
  };
}
