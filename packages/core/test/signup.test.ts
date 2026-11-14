import { describe, expect, it } from 'vitest';
import {
  canOpenSignupStep,
  currentSignupStep,
  nextOnboardingStep,
  signupRedirect,
  type SignupSnapshot,
  type SignupStep,
} from '../src/signup.js';

const anon: SignupSnapshot = { signedIn: false, pendingEmail: false, tenant: null, mfa: false };
const pendingCode: SignupSnapshot = { ...anon, pendingEmail: true };
const verified: SignupSnapshot = { ...anon, signedIn: true };
const tenant = (
  signupState: 'pending_plan' | 'pending_payment' | 'active',
  extra: Partial<NonNullable<SignupSnapshot['tenant']>> = {},
  mfa = false,
): SignupSnapshot => ({
  ...verified,
  mfa,
  tenant: {
    signupState,
    onboardingStep: signupState === 'active' ? 'webshop' : null,
    onboardingSkipped: false,
    role: 'owner',
    ...extra,
  },
});

const ALL: SignupStep[] = [
  'account',
  'verify',
  'company',
  'plan',
  'payment',
  'welcome',
  'mfa',
  'webshop',
  'accounting',
  'template',
  'test',
  'done',
  'app',
];

describe('currentSignupStep', () => {
  it('follows the state machine', () => {
    expect(currentSignupStep(anon)).toBe('account');
    expect(currentSignupStep(pendingCode)).toBe('verify');
    expect(currentSignupStep(verified)).toBe('company');
    expect(currentSignupStep(tenant('pending_plan'))).toBe('plan');
    expect(currentSignupStep(tenant('pending_payment'))).toBe('payment');
    expect(currentSignupStep(tenant('active'))).toBe('mfa');
    expect(currentSignupStep(tenant('active', {}, true))).toBe('webshop');
    expect(currentSignupStep(tenant('active', { onboardingStep: 'test' }, true))).toBe('test');
  });

  it('sends finished, skipped and non-owner users to the app', () => {
    expect(currentSignupStep(tenant('active', { onboardingStep: 'done' }, true))).toBe('app');
    expect(currentSignupStep(tenant('active', { onboardingSkipped: true }, true))).toBe('app');
    expect(currentSignupStep(tenant('active', { role: 'admin' }, true))).toBe('app');
    expect(currentSignupStep(tenant('active', { onboardingStep: null }, true))).toBe('app');
  });
});

describe('signupRedirect', () => {
  it('lets every state open its own step', () => {
    for (const s of [
      anon,
      pendingCode,
      verified,
      tenant('pending_plan'),
      tenant('pending_payment'),
    ])
      expect(signupRedirect(currentSignupStep(s), s)).toBeNull();
  });

  it('sends a visitor who opens a later step too early to their current step', () => {
    expect(signupRedirect('payment', verified)).toBe('/signup/company');
    expect(signupRedirect('plan', anon)).toBe('/signup');
    expect(signupRedirect('company', pendingCode)).toBe('/signup/verify');
    expect(signupRedirect('welcome', tenant('pending_payment'))).toBe('/signup/payment');
    expect(signupRedirect('webshop', tenant('pending_payment'))).toBe('/signup/payment');
    expect(signupRedirect('app', tenant('pending_plan'))).toBe('/signup/plan');
    expect(
      signupRedirect('template', tenant('active', { onboardingStep: 'accounting' }, true)),
    ).toBe('/onboarding/accounting');
  });

  it('allows going back within the signup phase', () => {
    expect(signupRedirect('company', tenant('pending_payment'))).toBeNull();
    expect(signupRedirect('plan', tenant('pending_payment'))).toBeNull();
    expect(signupRedirect('account', pendingCode)).toBeNull();
    expect(
      signupRedirect('webshop', tenant('active', { onboardingStep: 'template' }, true)),
    ).toBeNull();
  });

  it('never shows signup steps to an active company', () => {
    const active = tenant('active', { onboardingStep: 'done' }, true);
    for (const step of ['account', 'verify', 'company', 'plan', 'payment', 'welcome'] as const)
      expect(signupRedirect(step, active)).toBe('/');
    expect(signupRedirect('done', active)).toBeNull();
  });

  it('asks for a second factor before onboarding', () => {
    const s = tenant('active');
    expect(signupRedirect('welcome', s)).toBeNull();
    expect(signupRedirect('webshop', s)).toBe('/login/mfa/setup?next=/onboarding/webshop');
    expect(signupRedirect('mfa', s)).toBeNull();
    expect(signupRedirect('mfa', tenant('active', {}, true))).toBe('/onboarding/webshop');
  });

  it('lets a skipped owner resume onboarding from the reminder', () => {
    const s = tenant('active', { onboardingSkipped: true, onboardingStep: 'accounting' }, true);
    expect(signupRedirect('accounting', s)).toBeNull();
    expect(signupRedirect('app', s)).toBeNull();
  });

  it('keeps members who are not the owner out of signup and onboarding', () => {
    const s = tenant('active', { role: 'reader' }, true);
    for (const step of ALL.filter((x) => x !== 'app'))
      expect(canOpenSignupStep(step, s)).toBe(false);
  });
});

describe('nextOnboardingStep', () => {
  it('walks the onboarding in order and stops at done', () => {
    expect(nextOnboardingStep('webshop')).toBe('accounting');
    expect(nextOnboardingStep('test')).toBe('done');
    expect(nextOnboardingStep('done')).toBe('done');
  });
});
