import { describe, expect, it } from 'vitest';
import { C, DARK } from '../src/theme.js';

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
function ratio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Every text colour on every background it is used on in the blocks, light and dark. */
const LIGHT: [string, string, string][] = [
  ['body text on card', C.fg, C.card],
  ['muted on card', C.muted, C.card],
  ['muted on soft panel', C.muted, C.soft],
  ['footer on page', C.footer, C.bg],
  ['button label on lime', C.fg, C.lime],
  ['red due date on panel', C.bad, C.soft],
  ['red status on card', C.bad, C.card],
  ['green status on card', C.ok, C.card],
  ['text on info notice', C.fg, C.info.bg],
  ['text on warning notice', C.fg, C.warning.bg],
  ['text on error notice', C.fg, C.error.bg],
];
const DARK_PAIRS: [string, string, string][] = [
  ['body text on card', DARK.fg, DARK.card],
  ['muted on card', DARK.muted, DARK.card],
  ['muted on soft panel', DARK.muted, DARK.soft],
  ['footer on page', DARK.footer, DARK.bg],
  ['red on card', DARK.bad, DARK.card],
  ['green on card', DARK.ok, DARK.card],
  ['text on info notice', DARK.fg, DARK.info],
  ['text on warning notice', DARK.fg, DARK.warning],
  ['text on error notice', DARK.fg, DARK.error],
  ['button label on lime (unchanged in dark)', C.fg, C.lime],
];

describe('contrast 4.5:1 (README decision 26)', () => {
  for (const [name, fg, bg] of LIGHT)
    it(`light: ${name}`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
  for (const [name, fg, bg] of DARK_PAIRS)
    it(`dark: ${name}`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
});
