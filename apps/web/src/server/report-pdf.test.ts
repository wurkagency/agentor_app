import { describe, expect, it } from 'vitest';
import { textWidth } from './invoice-pdf';
import { pdfTexts, reportPdf } from './report-pdf';

const base = {
  title: 'Fakturering',
  subtitle: '1. okt. 2026 – 31. okt. 2026',
  kpis: [{ label: 'Faktureret', value: '61.284,00 kr.' }],
  pageLabel: (p: number, n: number) => `Side ${p} af ${n}`,
  footer: 'Agentor · beløb er inkl. moms',
};

describe('report PDF', () => {
  it('runs a long table over several pages with the heading repeated', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [
      `INV/2026/${10000 + i}`,
      'Nordlys Cykler ApS',
    ]);
    const pdf = reportPdf({
      ...base,
      tables: [
        {
          heading: 'Fakturaer',
          columns: [
            { label: 'Nummer', weight: 1 },
            { label: 'Kunde', weight: 2 },
          ],
          rows,
        },
      ],
    });
    const s = pdf.toString('latin1');
    const pages = Number(/\/Count (\d+)/.exec(s)![1]);
    expect(pages).toBeGreaterThan(1);
    const texts = pdfTexts(pdf);
    for (const [n] of rows) expect(texts).toContain(n);
    expect(texts.filter((t) => t === 'Nummer').length).toBe(pages);
    expect(texts).toContain(`Side ${pages} af ${pages}`);
    // xref offsets point at their objects.
    const offsets = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(s.startsWith(`${i + 1} 0 obj`, off)).toBe(true));
  });

  it('keeps Danish letters and cuts text that is too wide for its column', () => {
    const pdf = reportPdf({
      ...base,
      tables: [
        {
          heading: 'Største kunder',
          columns: [
            { label: 'Kunde', weight: 1 },
            { label: 'Beløb', weight: 10, align: 'right' },
          ],
          rows: [['Øresund Æblemost og Brødbageri ApS', '1.234,50 kr.']],
        },
      ],
    });
    const texts = pdfTexts(pdf);
    expect(texts).toContain('Største kunder');
    expect(texts).toContain('1.234,50 kr.');
    expect(texts.some((t) => t.startsWith('Øres') && t.endsWith('…'))).toBe(true);
  });

  it('measures Helvetica widths', () => {
    expect(textWidth('0', 10)).toBeCloseTo(5.56);
    expect(textWidth('W', 10, true)).toBeCloseTo(9.44);
  });
});
