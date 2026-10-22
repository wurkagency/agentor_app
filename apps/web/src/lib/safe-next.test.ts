import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps relative app paths', () => {
    expect(safeNext('/invite/abc')).toBe('/invite/abc');
    expect(safeNext('/integrations?x=1')).toBe('/integrations?x=1');
  });

  it('rejects anything that could leave the app', () => {
    const bad = [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      '/a\r\nb',
    ];
    for (const v of bad) expect(safeNext(v)).toBe('/');
  });
});
