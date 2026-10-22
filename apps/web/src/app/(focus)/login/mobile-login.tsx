'use client';

import { Banner } from '@agentor/ui';
import { BigButton } from '@agentor/ui/mobile';
import { ArrowLeft, KeyRound, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { syncLocale } from '@/app/actions/session';
import { DeviceGuard } from '@/components/mobile/pwa';
import { authClient } from '@/lib/auth-client';

/**
 * MA01 Log ind: passkey first (WebAuthn through Better Auth; the phone unlocks it with Face ID,
 * Touch ID or a fingerprint, never named on the button), e-mail and password + TOTP as the
 * fallback (the same form as desktop D14, G2).
 */
export function MobileLogin({ next, form }: { next: string; form: ReactNode }) {
  const t = useTranslations('mobile.login');
  const router = useRouter();
  const [mode, setMode] = useState<'passkey' | 'email'>('passkey');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function passkey() {
    setFailed(false);
    setBusy(true);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setBusy(false);
      setFailed(true);
      return;
    }
    await syncLocale();
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {/* Signed out (or 401): nothing of the last person stays on this device (M3). */}
      <DeviceGuard owner={null} />
      <p className="m-0 text-center text-m-lead text-fg-2">{t('tagline')}</p>
      {mode === 'passkey' ? (
        <div className="mt-auto flex flex-col gap-3">
          {failed && <Banner tone="error">{t('passkeyFailed')}</Banner>}
          <BigButton icon={KeyRound} loading={busy} onClick={passkey}>
            {busy ? t('passkeyBusy') : t('passkey')}
          </BigButton>
          <p className="m-0 text-center text-meta font-medium text-fg-2">{t('passkeyHelp')}</p>
          <BigButton variant="secondary" icon={Mail} onClick={() => setMode('email')}>
            {t('email')}
          </BigButton>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-md bg-surface p-5 shadow-sm">
          {form}
          <button
            type="button"
            onClick={() => setMode('passkey')}
            className="touch-target inline-flex items-center justify-center gap-1.5 self-center border-0 bg-transparent font-sans text-table font-semibold text-fg-1"
          >
            <ArrowLeft aria-hidden width={16} height={16} />
            {t('back')}
          </button>
        </div>
      )}
      <p className="m-0 text-center text-meta font-medium text-fg-2">
        {t('newUser')}{' '}
        <Link href="/signup" className="font-semibold text-fg-1">
          {t('signup')}
        </Link>
      </p>
    </div>
  );
}
