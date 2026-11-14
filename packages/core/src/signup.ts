/**
 * Self-service signup and onboarding (PLAN-SIGNUP §2–§3): which step a visitor is on, and which
 * steps they may open. One pure function, so the route guards on every page agree.
 */

/** "Ordrer pr. måned" on SU3/MS3; matches plan_entitlements.recommended_for_orders. */
export const ORDER_BUCKETS = ['lt100', '100-1000', 'gt1000'] as const;
export type OrderBucket = (typeof ORDER_BUCKETS)[number];

export const SIGNUP_STATES = ['pending_plan', 'pending_payment', 'active'] as const;
export type SignupState = (typeof SIGNUP_STATES)[number];

export const ONBOARDING_STEPS = ['webshop', 'accounting', 'template', 'test', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type SignupStep =
  | 'account'
  | 'verify'
  | 'company'
  | 'plan'
  | 'payment'
  | 'welcome'
  | 'mfa'
  | OnboardingStep
  | 'app';

export const SIGNUP_PATHS: Record<SignupStep, string> = {
  account: '/signup',
  verify: '/signup/verify',
  company: '/signup/company',
  plan: '/signup/plan',
  payment: '/signup/payment',
  welcome: '/signup/welcome',
  mfa: '/login/mfa/setup?next=/onboarding/webshop',
  webshop: '/onboarding/webshop',
  accounting: '/onboarding/accounting',
  template: '/onboarding/template',
  test: '/onboarding/test',
  done: '/onboarding/done',
  app: '/',
};

export interface SignupSnapshot {
  /** A Better Auth session exists (only after the e-mail is verified, or via SSO). */
  signedIn: boolean;
  /** An e-mail signup is waiting for its code (the signed signup_pending cookie). */
  pendingEmail: boolean;
  /** The user's own company, if any; null for no company yet. */
  tenant: {
    signupState: SignupState;
    onboardingStep: OnboardingStep | null;
    onboardingSkipped: boolean;
    role: 'owner' | 'admin' | 'developer' | 'reader';
  } | null;
  /** Second factor set up (owners need it before onboarding stores keys, B9). */
  mfa: boolean;
}

const ONBOARDING_ORDER: readonly OnboardingStep[] = ONBOARDING_STEPS;

/** Where the visitor should be now: resuming always lands here. */
export function currentSignupStep(s: SignupSnapshot): SignupStep {
  if (!s.signedIn) return s.pendingEmail ? 'verify' : 'account';
  const t = s.tenant;
  if (!t) return 'company';
  if (t.signupState === 'pending_plan') return 'plan';
  if (t.signupState === 'pending_payment') return 'payment';
  if (t.role !== 'owner' || !t.onboardingStep || t.onboardingStep === 'done' || t.onboardingSkipped)
    return 'app';
  return s.mfa ? t.onboardingStep : 'mfa';
}

/** Whether a step's page may be shown. Earlier steps of the same phase can be revisited. */
export function canOpenSignupStep(requested: SignupStep, s: SignupSnapshot): boolean {
  const cur = currentSignupStep(s);
  const t = s.tenant;
  const owner = t?.role === 'owner';
  const active = t?.signupState === 'active';
  switch (requested) {
    case 'account':
      return cur === 'account' || cur === 'verify';
    case 'verify':
      return cur === 'verify';
    case 'company':
      return cur === 'company' || cur === 'plan' || cur === 'payment';
    case 'plan':
      return cur === 'plan' || cur === 'payment';
    case 'payment':
      return cur === 'payment';
    case 'welcome':
      return active && owner && t.onboardingStep !== null && t.onboardingStep !== 'done';
    case 'mfa':
      return active && owner && !s.mfa;
    case 'app':
      return cur === 'app';
    case 'done':
      return active && owner && t.onboardingStep === 'done';
    default: {
      // An onboarding step: reached or passed, and the owner has a second factor.
      if (!active || !owner || !s.mfa || !t.onboardingStep || t.onboardingStep === 'done')
        return false;
      return ONBOARDING_ORDER.indexOf(requested) <= ONBOARDING_ORDER.indexOf(t.onboardingStep);
    }
  }
}

/** null when the requested step may be shown, else the path to send the visitor to. */
export function signupRedirect(requested: SignupStep, s: SignupSnapshot): string | null {
  if (canOpenSignupStep(requested, s)) return null;
  return SIGNUP_PATHS[currentSignupStep(s)];
}

/** The next onboarding step after one is finished (or skipped within the step). */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_ORDER.indexOf(step);
  return ONBOARDING_ORDER[Math.min(i + 1, ONBOARDING_ORDER.length - 1)]!;
}
