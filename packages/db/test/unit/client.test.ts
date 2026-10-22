import { describe, expect, it } from 'vitest';
import { isUuid } from '../../src/client.js';
import { GLOBAL_TABLES, NON_TENANT_RLS_TABLES } from '../../src/tables.js';

describe('isUuid', () => {
  it('accepts canonical UUIDs and rejects anything else', () => {
    expect(isUuid('0190a000-0000-7000-8000-00000000000a')).toBe(true);
    expect(isUuid('0190A000-0000-7000-8000-00000000000A')).toBe(true);
    for (const bad of [
      '',
      'x',
      "' or 1=1 --",
      '0190a000-0000-7000-8000-00000000000',
      42,
      null,
      undefined,
    ]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe('table classification', () => {
  it('never lists a table as both global and RLS-protected', () => {
    for (const t of Object.keys(GLOBAL_TABLES)) expect(t in NON_TENANT_RLS_TABLES).toBe(false);
  });
});
