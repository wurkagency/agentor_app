import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOARD,
  EMAIL_KEYS,
  renderEmail,
  SAMPLES,
  SAMPLE_NOW,
  type EmailKey,
} from '../src/index.js';

const APP = 'https://app.agentor.dk';
const render = (key: EmailKey, locale: 'da' | 'en' = 'da') =>
  renderEmail(key, SAMPLES[key] as never, { appUrl: APP, locale, now: SAMPLE_NOW });

/** Subject and preheader from each board's "Til udvikling" strip, read from the board files. */
const BOARDS_DIR = join(import.meta.dirname, '../../../docs/design/runde-1/boards');
function boardStrip(board: string): { subject: string; preheader: string } | null {
  let files: string[];
  try {
    files = readdirSync(BOARDS_DIR);
  } catch {
    return null;
  }
  const file = files.find((f) => f.startsWith(`${board}-`));
  if (!file) return null;
  const text = readFileSync(join(BOARDS_DIR, file), 'utf8')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
  const m = /Emne: (.+?) · Forhåndstekst: "(.+?)"/.exec(text);
  return m ? { subject: m[1]!, preheader: m[2]! } : null;
}

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('e-mail templates (E01–E22)', () => {
  it('has all 22 boards', () => {
    expect(EMAIL_KEYS).toHaveLength(22);
    expect(new Set(Object.values(BOARD)).size).toBe(22);
  });

  for (const key of EMAIL_KEYS) {
    describe(`${BOARD[key]} ${key}`, () => {
      const mail = render(key);

      it('matches the HTML and text snapshots', async () => {
        await expect(mail.html).toMatchFileSnapshot(`__snapshots__/${BOARD[key]}-${key}.html`);
        await expect(mail.text).toMatchFileSnapshot(`__snapshots__/${BOARD[key]}-${key}.txt`);
      });

      it("uses the board's subject and preheader with the board's sample data", () => {
        const strip = boardStrip(BOARD[key]);
        if (!strip) return; // boards live in docs/design; skipped where the folder is absent
        // Dates in the board samples that are fixed by the calendar differ (E22's week).
        if (key === 'weekly-summary') {
          expect(nbsp(mail.subject)).toBe(strip.subject);
          return;
        }
        expect(nbsp(mail.subject)).toBe(strip.subject);
        expect(nbsp(mail.preheader)).toBe(strip.preheader);
      });

      it('has no unresolved placeholders, and every link is absolute', () => {
        for (const s of [mail.subject, mail.preheader, mail.html, mail.text]) {
          expect(s).not.toMatch(/\{[a-zA-Z_]+[,}]/);
          expect(s).not.toMatch(/\*\*/);
          expect(s).not.toContain('undefined');
          expect(s).not.toContain('NaN');
        }
        const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
        for (const h of hrefs) expect(h).toMatch(/^(https:\/\/|mailto:)/);
        const srcs = [...mail.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
        for (const s of srcs) expect(s).toMatch(/^https:\/\//);
      });

      it('has the preheader as the first, hidden element and the colour-scheme meta', () => {
        const body = mail.html.slice(mail.html.indexOf('<body'));
        const first = /<body[^>]*>\s*<div style="display: none[^"]*">([^<]*)/.exec(body);
        expect(first?.[1]).toContain(mail.preheader.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
        expect(mail.html).toContain('<meta name="color-scheme" content="light dark">');
        expect(mail.html).toContain('alt="Agentor"');
        expect(mail.subject.trim()).not.toBe('');
        expect(mail.preheader.trim()).not.toBe('');
      });

      it('has a text version in the same order: heading, body, link, footer', () => {
        const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(mail.html)?.[1];
        expect(heading).toBeTruthy();
        const t = mail.text;
        expect(
          t.startsWith(
            heading!
              .replace(/&amp;/g, '&')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'"),
          ),
        ).toBe(true);
        expect(t).toContain('Agentor ApS · app.agentor.dk · support@agentor.dk');
        expect(t.indexOf('Agentor ApS ·')).toBeGreaterThan(t.indexOf('Venlig hilsen'));
        const button = /<a href="(https:[^"]+)" target="_blank" style="display: inline-block/.exec(
          mail.html,
        );
        if (button) {
          expect(t).toContain(button[1]!.replace(/&amp;/g, '&'));
          expect(t.indexOf(button[1]!.replace(/&amp;/g, '&'))).toBeLessThan(
            t.indexOf('Agentor ApS ·'),
          );
        }
      });

      it('renders in English too', () => {
        const en = render(key, 'en');
        expect(en.html).toContain('<html lang="en"');
        expect(en.text).not.toMatch(/\{[a-zA-Z_]+[,}]/);
      });
    });
  }
});

describe('mail-specific rules', () => {
  it('E03 and E05 have no button and no sign-in link', () => {
    for (const key of ['new-device-login', 'email-changed'] as const) {
      const m = render(key);
      expect(m.html).not.toContain('display: inline-block; padding: 16px 32px');
      expect(m.html).not.toMatch(
        /href="https:\/\/app\.agentor\.dk\/(login|verify|reset|invite|claim)/,
      );
      const links = [...m.html.matchAll(/<a href="([^"]+)"/g)].map((x) => x[1]);
      expect(links.every((l) => l?.startsWith('mailto:'))).toBe(true);
    }
  });

  it('E04 and E06 put the code first in the subject and in six cells', () => {
    for (const key of ['email-change-code', 'signup-code'] as const) {
      const m = render(key);
      const code = (SAMPLES[key] as { code: string }).code;
      expect(m.subject.startsWith(`${code} `)).toBe(true);
      expect(m.html.match(/font-size: 30px; font-weight: 500/g)).toHaveLength(6);
      expect(m.text).toContain(code);
    }
  });

  it('E05 shows the new address masked only', () => {
    const m = render('email-changed');
    expect(m.html).toContain('me•••@nordlys-cykler.dk');
    expect(m.html).not.toContain('mette.holm@');
  });

  it('E09 leaves out access and expiry when they are not set', () => {
    const m = renderEmail(
      'team-invite',
      { ...SAMPLES['team-invite'], access: null, accessExpiresAt: null },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.text).not.toContain('Adgang:');
    expect(m.text).not.toContain('Adgangen udløber');
    expect(m.text).toContain('Rolle:');
  });

  it('E12 shows only the blocks the supporter switched on', () => {
    const m = renderEmail(
      'case-resolved',
      { ...SAMPLES['case-resolved'], history: null, minutes: null, askSatisfaction: false },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.text).not.toContain('FORLØB');
    expect(m.text).not.toContain('Tidsforbrug');
    expect(m.text).not.toContain('tilfreds');
    expect(m.text).toContain('genåbne sagen (#2291)');
  });

  it('E12 escapes what people wrote', () => {
    const m = renderEmail(
      'case-resolved',
      {
        ...SAMPLES['case-resolved'],
        closing: 'Hej {name}. <script>alert(1)</script> & tak',
      },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('E15 says "2. påmindelse" in the subject for the second reminder', () => {
    const m = renderEmail(
      'invoice-reminder',
      { ...SAMPLES['invoice-reminder'], reminder: 2 },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.subject).toBe('2. påmindelse: faktura 2026-1047 fra Agentor');
  });

  it('E17 says "Ingen åbne poster" without lines', () => {
    const m = renderEmail(
      'account-statement',
      { ...SAMPLES['account-statement'], lines: [] },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.text).toContain('Ingen åbne poster');
    expect(m.preheader).toBe('Ingen åbne poster.');
  });

  it('E17 totals the lines in øre', () => {
    const m = render('account-statement');
    expect(nbsp(m.text)).toContain('I alt: 2.198,75 kr.');
  });

  it('E20 puts several incidents held over quiet hours in one mail', () => {
    const one = SAMPLES['notify-systematic-error'].incidents[0]!;
    const m = renderEmail(
      'notify-systematic-error',
      {
        ...SAMPLES['notify-systematic-error'],
        incidents: [one, { ...one, flow: 'Outlet → regnskab', count: 4 }],
      },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.text).toContain('Webshop → regnskab og CRM: 3 ordrer');
    expect(m.text).toContain('Outlet → regnskab: 4 ordrer');
  });

  it('E22 lists at most 5 flows, problems first', () => {
    const flows = Array.from({ length: 7 }, (_, i) => ({
      name: `Flow ${i}`,
      records: 100 - i,
      errors: i === 6 ? 2 : 0,
      brokenSince: null,
    }));
    const m = renderEmail(
      'weekly-summary',
      { ...SAMPLES['weekly-summary'], flows },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    const listed = [...m.text.matchAll(/^Flow \d/gm)].map((x) => x[0]);
    expect(listed).toEqual(['Flow 6', 'Flow 0', 'Flow 1', 'Flow 2', 'Flow 3']);
  });

  it('E21 caps the bar at 100 %', () => {
    const m = renderEmail(
      'notify-quota-80',
      { ...SAMPLES['notify-quota-80'], used: 2600 },
      { appUrl: APP, now: SAMPLE_NOW },
    );
    expect(m.html).toContain('width: 100%; border-radius: 9999px; background: #D0E84A');
  });
});
