'use client';

import { Banner, cn, Icon } from '@agentor/ui';
import { BigButton, MobileField, MobileInput } from '@agentor/ui/mobile';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MFA_LENGTH, useMfa } from './use-mfa';

/**
 * MA34 Totrinsbekræftelse: the same form as D14-MFA in the phone's layout: title and intro on the
 * left, six full-width digit boxes, "Husk denne enhed", a big "Bekræft" and the two links.
 */
export function MobileMfa() {
  const t = useTranslations('auth');
  const m = useMfa();
  return (
    <form className="flex w-full flex-1 flex-col gap-3" onSubmit={m.onSubmit} noValidate>
      <div className="flex flex-col gap-1.5 pt-2">
        <h1 className="m-0 text-m-title">{t('mfaTitle')}</h1>
        <p className="m-0 text-body text-fg-2">{m.backupMode ? t('backupIntro') : t('mfaIntro')}</p>
      </div>
      {m.error && <Banner tone="error">{t(`errors.${m.error}`)}</Banner>}
      {m.backupMode ? (
        <MobileField label={t('backupLabel')}>
          <MobileInput
            autoComplete="one-time-code"
            autoCapitalize="none"
            className="font-mono"
            value={m.backupCode}
            onChange={(e) => m.setBackupCode(e.target.value)}
          />
        </MobileField>
      ) : (
        <fieldset className="m-0 flex min-w-0 gap-2 border-0 p-0">
          <legend className="sr-only">{t('mfaIntro')}</legend>
          {m.digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                m.refs.current[i] = el;
              }}
              aria-label={t('digit', { n: i + 1 })}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={MFA_LENGTH}
              value={d}
              onChange={(e) => m.setDigit(i, e.target.value)}
              onKeyDown={(e) => m.onKeyDown(i, e)}
              onPaste={m.onPaste}
              className={cn(
                'box-border h-14 min-w-0 flex-1 rounded-node border-0 bg-surface text-center font-sans text-stat-compact font-bold text-fg-1',
                d ? 'shadow-ring-strong' : 'shadow-ring-dark-2',
              )}
            />
          ))}
        </fieldset>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg-1">
        <input
          type="checkbox"
          className="sr-only"
          checked={m.trust}
          onChange={(e) => m.setTrust(e.target.checked)}
        />
        <span
          aria-hidden
          className={cn(
            'grid size-5.5 flex-none place-items-center rounded-xs',
            m.trust ? 'bg-fg-1 text-primary' : 'bg-white shadow-ring-off',
          )}
        >
          {m.trust && <Icon icon={Check} size={14} />}
        </span>
        {t('rememberDevice')}
      </label>
      <BigButton type="submit" loading={m.busy} disabled={!m.complete}>
        {m.busy ? t('confirming') : t('confirm')}
      </BigButton>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={m.toggleBackup}
          className="touch-target cursor-pointer border-0 bg-transparent p-0 font-sans text-table font-semibold text-fg-1"
        >
          {m.backupMode ? t('useApp') : t('useBackup')}
        </button>
        <Link href="/login" className="touch-target text-table font-semibold text-fg-1">
          {t('back')}
        </Link>
      </div>
    </form>
  );
}
