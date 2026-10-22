import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  env: () => ({
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    SSO_MODE: 'mock',
    APP_URL: 'http://localhost:3000',
  }),
  isProduction: () => false,
}));
vi.mock('./infra', () => ({ db: () => ({}), redis: () => ({}) }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));

const { parseDocumentVersion } = await import('./legal');
const { decodeMockToken, encodeMockToken } = await import('./mock-sso');
const { resendWait } = await import('./signup');

describe('terms version from agentor.dk (B12)', () => {
  it('reads the agreed meta tag in either attribute order', () => {
    expect(
      parseDocumentVersion(
        '<head><meta name="agentor-document-version" content="2026-11-01"></head>',
      ),
    ).toBe('2026-11-01');
    expect(parseDocumentVersion(`<meta content='v3.2' name='agentor-document-version' />`)).toBe(
      'v3.2',
    );
  });

  it('refuses a page without a usable version', () => {
    expect(parseDocumentVersion('<html><title>Betingelser</title></html>')).toBeNull();
    expect(
      parseDocumentVersion('<meta name="agentor-document-version" content="<script>">'),
    ).toBeNull();
  });
});

describe('mock identity provider tokens', () => {
  it('round-trips a signed identity and rejects tampering', () => {
    const t = encodeMockToken({
      provider: 'google',
      email: 'Mette@Nordlys-Cykler.dk',
      name: 'Mette',
    });
    expect(decodeMockToken(t)).toMatchObject({
      provider: 'google',
      email: 'mette@nordlys-cykler.dk',
    });
    const [payload, mac] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ provider: 'google', email: 'x@y.dk', name: 'X', exp: Date.now() + 9e6 }),
    ).toString('base64url');
    expect(decodeMockToken(`${forged}.${mac}`)).toBeNull();
    expect(decodeMockToken(`${payload}.AAAA`)).toBeNull();
    expect(decodeMockToken(null)).toBeNull();
  });
});

describe('resend countdown (SU2 "send koden igen om 0:42")', () => {
  it('counts down from 60 seconds after the last code', () => {
    const p = { email: 'a@b.dk', name: 'A', passwordHash: 'h', sentAt: 1_000_000 };
    expect(resendWait(p, 1_000_000)).toBe(60);
    expect(resendWait(p, 1_018_000)).toBe(42);
    expect(resendWait(p, 1_060_000)).toBe(0);
  });
});
