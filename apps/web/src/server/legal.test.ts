import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { production: false, env: {} as Record<string, string | undefined> };
vi.mock('./env', () => ({ env: () => state.env, isProduction: () => state.production }));

const { currentTermsForAcceptance } = await import('./legal');

describe('terms without published documents (B12, Q19)', () => {
  beforeEach(() => {
    state.production = false;
    state.env = { LEGAL_DEV_VERSION: 'ci' };
  });

  it('uses a marked placeholder in development', async () => {
    const docs = await currentTermsForAcceptance();
    expect(docs.map((d) => d.version)).toEqual(['dev:ci', 'dev:ci']);
  });

  it('allows the placeholder in production only while QuickPay is in test mode', async () => {
    state.production = true;
    state.env = { LEGAL_DEV_VERSION: 'ci', QUICKPAY_MODE: 'test' };
    expect((await currentTermsForAcceptance())[0]!.version).toBe('test:ci');
    state.env = { LEGAL_DEV_VERSION: 'ci', QUICKPAY_MODE: 'live' };
    await expect(currentTermsForAcceptance()).rejects.toThrow();
  });

  it('refuses without a placeholder version', async () => {
    state.env = {};
    await expect(currentTermsForAcceptance()).rejects.toThrow();
  });
});
