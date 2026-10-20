import { describe, expect, it } from 'vitest';
import { formatMessage, pushCategory, pushUrl, quietUntil } from '../src/push';

const FLOW = '0190b000-0000-7000-8000-000000000201';
const RUN = '0190b000-0000-7000-8000-000000000301';
const CONN = '0190b000-0000-7000-8000-000000000401';

describe('pushUrl', () => {
  it('opens the mobile screen for each kind', () => {
    expect(pushUrl(`/integrations/${FLOW}?tab=runs&run=${RUN}`)).toBe(
      `/integrations/${FLOW}/runs/${RUN}`,
    );
    expect(pushUrl(`/connections/${CONN}`)).toBe(`/connections/${CONN}/reconnect`);
    expect(pushUrl('/settings/security#support', { grantId: RUN })).toBe(`/support-access/${RUN}`);
    expect(pushUrl('/billing')).toBe('/billing');
  });

  it('never leaves the app', () => {
    expect(pushUrl('https://evil.example')).toBe('/notifications');
    expect(pushUrl('//evil.example')).toBe('/notifications');
    expect(pushUrl(null)).toBe('/notifications');
  });
});

describe('pushCategory', () => {
  it('maps messages to the MA11 toggles', () => {
    expect(pushCategory('recordsFailed')).toBe('errors');
    expect(pushCategory('connectionBroken')).toBe('connection');
    expect(pushCategory('supportRequested')).toBe('support');
    expect(pushCategory('published')).toBeNull();
  });
});

describe('quietUntil', () => {
  const quiet = { enabled: true, start: '22:00', end: '07:00' };
  // 23:30 in Copenhagen (UTC+2 in October).
  const night = new Date('2026-10-20T21:30:00Z');
  const day = new Date('2026-10-20T10:00:00Z');

  it('holds errors until 07:00 and lets the day through', () => {
    expect(quietUntil(night, quiet, 'errors').toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(quietUntil(day, quiet, 'errors')).toBe(day);
  });

  it('never holds support requests (B7) and respects quiet hours being off', () => {
    expect(quietUntil(night, quiet, 'support')).toBe(night);
    expect(quietUntil(night, { ...quiet, enabled: false }, 'errors')).toBe(night);
  });
});

describe('formatMessage', () => {
  it('fills names and plurals', () => {
    const t = '{count, plural, one {# record fejlede} other {# records fejlede}} i {flow}';
    expect(formatMessage(t, { count: 1, flow: 'Webshop' })).toBe('1 record fejlede i Webshop');
    expect(formatMessage(t, { count: 3, flow: 'Webshop' })).toBe('3 records fejlede i Webshop');
  });
});
