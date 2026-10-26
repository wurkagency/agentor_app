/**
 * Danish CVR numbers, one parser for every field that takes one (SU3/MS3, company settings,
 * Platform "Opret kunde") and for the server: people type "DK 12 34 56 74", "12345674" or the
 * VAT form "DK12345674", and all mean the same company.
 *
 * A CVR number is 8 digits, never starting with 0, and passes Erhvervsstyrelsen's modulus-11
 * check (weights 2 7 6 5 4 3 2 1). Foreign VAT numbers are recognised and refused with their own
 * reason: signup is for Danish companies only.
 */

export type CvrProblem = 'format' | 'checksum' | 'foreign';

export type CvrParse = { ok: true; cvr: string } | { ok: false; reason: CvrProblem };

const WEIGHTS = [2, 7, 6, 5, 4, 3, 2, 1] as const;

/** Spaces, dots, dashes and a leading "DK" removed; the rest as typed (upper case). */
export function normalizeCvr(input: string): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s.\-–]/g, '')
    .replace(/^DK/, '');
}

export function cvrChecksumOk(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  const sum = WEIGHTS.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  return sum % 11 === 0;
}

export function parseCvr(input: string): CvrParse {
  const v = normalizeCvr(input);
  // "SE556677889901", "DE123456789": another country's VAT number.
  if (/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v)) return { ok: false, reason: 'foreign' };
  if (!/^[1-9]\d{7}$/.test(v)) return { ok: false, reason: 'format' };
  if (!cvrChecksumOk(v)) return { ok: false, reason: 'checksum' };
  return { ok: true, cvr: v };
}

/** The 8 digits when the input is a valid CVR number, otherwise null. */
export function cvrOrNull(input: string): string | null {
  const r = parseCvr(input);
  return r.ok ? r.cvr : null;
}

/** Error code per problem, shared by the actions and the forms' texts. */
export const CVR_ERROR_CODES = {
  format: 'cvrFormat',
  checksum: 'cvrChecksum',
  foreign: 'cvrForeign',
} as const satisfies Record<CvrProblem, string>;
