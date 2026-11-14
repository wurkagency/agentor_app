import { describe, expect, it } from 'vitest';
import {
  creditNotePdf,
  DocumentTotalsError,
  invoicePdf,
  longInvoice,
  pdfText,
  SAMPLE_CREDIT_NOTE,
  SAMPLE_EAN_INVOICE,
  SAMPLE_SUBSCRIPTION_INVOICE,
  SAMPLE_SUPPORT_INVOICE,
} from '../src/index.js';

const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const text = (pdf: Buffer) => nb(pdfText(pdf).join('\n'));
const pages = (pdf: Buffer) => Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))![1]);

/** The text drawn on each page, from the content streams in page order. */
function perPage(pdf: Buffer): string[] {
  const s = pdf.toString('latin1');
  return [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) =>
    nb(pdfText(Buffer.from(m[1]!, 'latin1')).join('\n')),
  );
}

describe('invoice PDF (I01)', () => {
  it('is a valid PDF with a correct cross-reference table', () => {
    const pdf = invoicePdf(SAMPLE_SUPPORT_INVOICE).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(pdf.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('shows the number, the parties, the lines, totals with 25 % VAT and payment', () => {
    const t = text(invoicePdf(SAMPLE_SUPPORT_INVOICE));
    for (const s of [
      'FAKTURA',
      '2026-1063',
      'Fakturadato',
      'K-1042',
      'Nordlys Cykler ApS',
      'CVR 12345678',
      '#2271 Ordrer synkroniseres dobbelt',
      '2,25 t',
      '1.440,00',
      'Subtotal ekskl. moms',
      '2.880,00 kr.',
      'Moms 25 %',
      '720,00 kr.',
      'I alt inkl. moms',
      '3.600,00 kr.',
      'Betalt',
      'Visa •••• 4242',
      'Transaktion QP-48213977',
      'Timepris 640,00 kr. ekskl. moms',
      'Side 1 af 2',
    ])
      expect(t).toContain(s);
  });

  it('prints placeholders until Agentor’s details are filled in, and the details after', () => {
    expect(text(invoicePdf(SAMPLE_SUPPORT_INVOICE))).toContain('CVR [CVR]');
    const filled = invoicePdf({
      ...SAMPLE_SUPPORT_INVOICE,
      seller: {
        ...SAMPLE_SUPPORT_INVOICE.seller,
        cvr: '11223344',
        address: 'Testvej 1',
        postalCity: '8000 Aarhus C',
        bankReg: '1234',
        bankAccount: '1234567',
        iban: 'DK5000400440116243',
      },
    });
    const t = text(filled);
    expect(t).toContain('CVR 11223344');
    expect(t).toContain('IBAN DK5000400440116243');
    expect(t).not.toContain('[CVR]');
  });

  it('refuses totals that are not the sum of the lines (øre)', () => {
    expect(() => invoicePdf({ ...SAMPLE_SUPPORT_INVOICE, netOre: 288_001 })).toThrow(
      DocumentTotalsError,
    );
  });

  it('has the subscription and EAN variants from the same template', () => {
    const sub = text(invoicePdf(SAMPLE_SUBSCRIPTION_INVOICE));
    expect(sub).toContain('Agentor Business, årligt');
    expect(sub).toContain('Betales årligt forud');
    const ean = text(invoicePdf(SAMPLE_EAN_INVOICE));
    expect(ean).toContain('Forfald');
    expect(ean).toContain('EAN 5790001234567');
    expect(ean).not.toContain('Betalt med');
  });

  it('runs a long invoice over pages with the table heading on every page', () => {
    const pdf = invoicePdf(longInvoice(40));
    const n = pages(pdf);
    expect(n).toBeGreaterThan(1);
    const each = perPage(pdf);
    expect(each).toHaveLength(n);
    each.forEach((p, i) => {
      expect(p).toContain(`Side ${i + 1} af ${n}`);
      // Every page with rows has the heading; the totals may stand alone on the last one.
      if (/#30\d\d/.test(p)) expect(p).toContain('BESKRIVELSE');
    });
    expect(each.filter((p) => p.includes('I alt inkl. moms'))).toHaveLength(1);
    expect(text(pdf)).toContain('8.000,00 kr.');
  });

  it('puts the time log on its own pages after the invoice', () => {
    const each = perPage(invoicePdf(SAMPLE_SUPPORT_INVOICE));
    expect(each).toHaveLength(2);
    expect(each[1]).toContain('Bilag: tidslog');
    expect(each[1]).toContain('Faktura 2026-1063 (fortsat)');
  });

  it('is deterministic: the same invoice gives the same bytes (immutable documents)', () => {
    expect(invoicePdf(SAMPLE_SUPPORT_INVOICE).equals(invoicePdf(SAMPLE_SUPPORT_INVOICE))).toBe(
      true,
    );
  });
});

describe('credit note PDF (I02)', () => {
  it('refers to the credited invoice, shows negative amounts and the refund', () => {
    const t = text(creditNotePdf(SAMPLE_CREDIT_NOTE));
    for (const s of [
      'KREDITNOTA',
      'K-2026-0007',
      'Krediterer',
      'Faktura 2026-1063',
      // Section labels are drawn in capitals, as on the board.
      'KREDITERES TIL',
      'ÅRSAG',
      'Krediteret af Kasper Nyborg',
      '–0,50 t',
      '–320,00',
      '–320,00 kr.',
      '–80,00 kr.',
      'Krediteret i alt inkl. moms',
      '–400,00 kr.',
      'Tilbageført',
      'Faktura 2026-1063 er herefter på 3.200,00 kr. inkl. moms.',
    ])
      expect(t).toContain(s);
  });

  it('says "Modregnes" for a set-off', () => {
    const t = text(creditNotePdf({ ...SAMPLE_CREDIT_NOTE, refund: { method: 'offset' } }));
    expect(t).toContain('Modregnes');
    expect(t).not.toContain('Tilbageført');
  });

  it('refuses totals that are not the sum of the lines', () => {
    expect(() => creditNotePdf({ ...SAMPLE_CREDIT_NOTE, netOre: -1 })).toThrow(DocumentTotalsError);
  });
});
