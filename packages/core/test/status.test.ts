import { describe, expect, it } from 'vitest';
import {
  needsAction,
  rollUpStatus,
  STATUSES,
  STATUS_SEVERITY,
  worseStatus,
} from '../src/status.js';

describe('status roll-up', () => {
  it('orders statuses Afbrudt > Fejl > Advarsel > Aktiv > Test > Pauset > Kladde', () => {
    const ordered = [...STATUSES].sort((a, b) => STATUS_SEVERITY[b] - STATUS_SEVERITY[a]);
    expect(ordered).toEqual(['broken', 'error', 'warn', 'ok', 'info', 'paused', 'draft']);
  });

  it('picks the worse of every pair, symmetrically', () => {
    for (const a of STATUSES) {
      for (const b of STATUSES) {
        const expected = STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
        expect(worseStatus(a, b)).toBe(expected);
        expect(worseStatus(b, a)).toBe(expected);
      }
    }
  });

  it('rolls up a flow: worst route wins', () => {
    expect(rollUpStatus(['ok', 'error', 'info', 'paused'])).toBe('error');
    expect(rollUpStatus(['ok', 'warn', 'broken'])).toBe('broken');
    expect(rollUpStatus(['ok', 'ok'])).toBe('ok');
  });

  it('does not count Pauset as a problem', () => {
    expect(rollUpStatus(['ok', 'paused'])).toBe('ok');
    expect(needsAction('paused')).toBe(false);
  });

  it('treats a flow without routes as Kladde', () => {
    expect(rollUpStatus([])).toBe('draft');
  });

  it('flags only Advarsel, Fejl and Afbrudt as needing action', () => {
    expect(STATUSES.filter(needsAction)).toEqual(['broken', 'error', 'warn']);
  });
});
