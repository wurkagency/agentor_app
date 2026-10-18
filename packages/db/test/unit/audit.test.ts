import { describe, expect, it } from 'vitest';
import { maskIp, redact } from '../../src/repo/audit.js';
import { hashInviteToken } from '../../src/repo/team.js';

describe('maskIp', () => {
  it('keeps two IPv4 octets, as shown in D12-Auditlog', () => {
    expect(maskIp('87.61.12.200')).toBe('87.61.•.•');
    expect(maskIp('::ffff:185.7.3.4')).toBe('185.7.•.•');
  });
  it('keeps the first three IPv6 groups', () => {
    expect(maskIp('2a02:aa7:40ff:1:2:3:4:5')).toBe('2a02:aa7:40ff:…');
  });
  it('returns null for nothing or garbage', () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('localhost')).toBeNull();
  });
});

describe('redact', () => {
  it('never lets secrets into the audit log, however nested', () => {
    expect(
      redact({
        name: 'Dinero',
        apiKey: 'abc',
        nested: { password: 'p', ok: 1 },
        list: [{ token: 't' }],
      }),
    ).toEqual({
      name: 'Dinero',
      apiKey: '[skjult]',
      nested: { password: '[skjult]', ok: 1 },
      list: [{ token: '[skjult]' }],
    });
  });
});

describe('invitation tokens', () => {
  it('stores a stable, URL-safe hash, never the token', () => {
    const h = hashInviteToken('raw-token');
    expect(h).toBe(hashInviteToken('raw-token'));
    expect(h).not.toContain('raw-token');
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
