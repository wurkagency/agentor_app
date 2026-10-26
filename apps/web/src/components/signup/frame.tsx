import { StepProgress, type TrustPoint } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** Server pieces shared by the SU/MS pages: step indicator, login link and trust points. */

const STEPS = ['account', 'company', 'plan', 'payment'] as const;

export async function SignupSteps({
  current,
  mobile = false,
  showNext = true,
}: {
  current: 1 | 2 | 3 | 4;
  mobile?: boolean;
  /** SU1/MS1 leave "Næste" out; SU2/MS2 (same step) show it. */
  showNext?: boolean;
}) {
  const t = await getTranslations('signupFlow');
  const labels = STEPS.map((s) => t(`steps.${s}`));
  const name = labels[current - 1]!;
  const next = current < 4 ? t('next', { name: labels[current]! }) : t('last');
  return (
    <StepProgress
      variant={mobile ? 'bottom' : 'top'}
      current={current}
      labels={labels}
      counter={t('counter', { n: current })}
      next={showNext ? next : undefined}
      label={mobile ? t('navLabelMobile', { n: current, name }) : t('navLabel', { n: current })}
    />
  );
}

/** "Har du allerede en konto? Log ind" (one wording on every screen, PLAN-SIGNUP Q16c). */
export async function LoginLink() {
  const t = await getTranslations('signupFlow');
  return (
    <>
      {t('loginPrompt')}{' '}
      <Link href="/login" className="font-semibold text-fg-1">
        {t('login')}
      </Link>
    </>
  );
}

/** Desktop boards use the long wording, mobile the short one (each board its own, Q16b). */
export async function trustPoints(short = false): Promise<TrustPoint[]> {
  const t = await getTranslations('signupFlow.trust');
  return [
    { key: 'eu', label: short ? t('euShort') : t('eu') },
    { key: 'keys', label: short ? t('keysShort') : t('keys') },
    { key: 'test', label: t('test') },
  ];
}
