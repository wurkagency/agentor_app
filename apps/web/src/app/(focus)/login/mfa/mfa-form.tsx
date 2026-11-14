'use client';

import { Banner, Button, Checkbox, Field, Input, cn } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MFA_LENGTH, useMfa } from './use-mfa';

/** Second factor (D14-MFA): six digit boxes, "Husk denne enhed i 30 dage", backup code. */
export function MfaForm() {
  const t = useTranslations('auth');
  const m = useMfa();

  return (
    <form className="flex flex-col gap-5" onSubmit={m.onSubmit} noValidate>
      {m.error && <Banner tone="error">{t(`errors.${m.error}`)}</Banner>}
      {m.backupMode ? (
        <Field label={t('backupLabel')} help={t('backupIntro')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoComplete="one-time-code"
              mono
              value={m.backupCode}
              onChange={(e) => m.setBackupCode(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <fieldset className="m-0 flex justify-between gap-2 border-0 p-0">
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
              autoFocus={i === 0}
              onChange={(e) => m.setDigit(i, e.target.value)}
              onKeyDown={(e) => m.onKeyDown(i, e)}
              onPaste={m.onPaste}
              className={cn(
                'box-border h-15 w-13 rounded-sm border border-border-strong bg-surface text-center font-sans text-stat-compact font-semibold text-fg-1',
                'focus-visible:border-fg-1',
              )}
            />
          ))}
        </fieldset>
      )}
      <label className="flex items-center gap-2.5 text-table">
        <Checkbox checked={m.trust} onCheckedChange={(v) => m.setTrust(v === true)} />
        {t('rememberDevice')}
      </label>
      <Button
        type="submit"
        variant="primary"
        size="l"
        className="w-full"
        loading={m.busy}
        disabled={!m.complete}
      >
        {m.busy ? t('confirming') : t('confirm')}
      </Button>
      <div className="flex justify-between text-table">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-fg-1 underline-offset-2 hover:underline"
          onClick={m.toggleBackup}
        >
          {m.backupMode ? t('useApp') : t('useBackup')}
        </button>
        <Link href="/login" className="text-fg-2">
          {t('back')}
        </Link>
      </div>
    </form>
  );
}
