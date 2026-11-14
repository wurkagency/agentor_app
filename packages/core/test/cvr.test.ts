import { describe, expect, it } from 'vitest';
import { cvrChecksumOk, cvrOrNull, normalizeCvr, parseCvr } from '../src/cvr.js';

// Fictional numbers that pass modulus 11 (seed and e2e use the same ones).
const VALID = ['12345674', '87654311', '11112226'];

describe('CVR numbers', () => {
  it('accepts valid numbers with spaces, dots, dashes and the DK prefix', () => {
    for (const input of [
      '12345674',
      ' 12345674 ',
      '12 34 56 74',
      '1234 5674',
      '12.34.56.74',
      '12-34-56-74',
      'DK12345674',
      'dk 12 34 56 74',
      'DK-12345674',
    ])
      expect(parseCvr(input), input).toEqual({ ok: true, cvr: '12345674' });
    for (const v of VALID) expect(cvrChecksumOk(v), v).toBe(true);
  });

  it('refuses a mistyped number (modulus 11)', () => {
    expect(parseCvr('12345678')).toEqual({ ok: false, reason: 'checksum' });
    expect(parseCvr('DK 87654321')).toEqual({ ok: false, reason: 'checksum' });
  });

  it('refuses the wrong length, letters and a leading zero as a format problem', () => {
    for (const input of ['', '1234567', '123456745', '1234567a', '01234567', 'DK', 'abc'])
      expect(parseCvr(input), input).toEqual({ ok: false, reason: 'format' });
  });

  it('recognises other EU VAT numbers as foreign', () => {
    for (const input of ['SE556677889901', 'DE123456789', 'NL123456789B01', 'FI 1234 5678'])
      expect(parseCvr(input), input).toEqual({ ok: false, reason: 'foreign' });
  });

  it('normalises and returns null for invalid input', () => {
    expect(normalizeCvr('dk 12.34-56 74')).toBe('12345674');
    expect(cvrOrNull('DK12345674')).toBe('12345674');
    expect(cvrOrNull('12345678')).toBeNull();
  });
});
