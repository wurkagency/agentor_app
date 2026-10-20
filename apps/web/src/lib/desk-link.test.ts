import { describe, expect, it } from 'vitest';
import { deskLinkPath } from './desk-link';

describe('deskLinkPath', () => {
  it('accepts app paths, with a query', () => {
    expect(deskLinkPath('/')).toBe('/');
    expect(deskLinkPath('/integrations/1f2e/editor')).toBe('/integrations/1f2e/editor');
    expect(deskLinkPath('/platform/finance/invoices?status=overdue')).toBe(
      '/platform/finance/invoices?status=overdue',
    );
  });

  it('rejects other origins and unknown areas', () => {
    expect(deskLinkPath('https://evil.example/')).toBeNull();
    expect(deskLinkPath('//evil.example')).toBeNull();
    expect(deskLinkPath('/\\evil')).toBeNull();
    expect(deskLinkPath('/api/auth/sign-out')).toBeNull();
    expect(deskLinkPath('/integrationsx')).toBeNull();
    expect(deskLinkPath('/settings\r\nBcc: x')).toBeNull();
    expect(deskLinkPath(42)).toBeNull();
    expect(deskLinkPath(`/activity/${'a'.repeat(600)}`)).toBeNull();
  });
});
