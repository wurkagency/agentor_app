import { describe, expect, it } from 'vitest';
import { pdfString, renderPdf } from './invoice-pdf';

describe('invoice PDF', () => {
  it('encodes Danish letters in WinAnsi and escapes PDF syntax', () => {
    expect(pdfString('Æble (ø) \\ å')).toBe('(\\306ble \\(\\370\\) \\\\ \\345)');
    expect(pdfString('• –')).toBe('(\\225 \\226)');
    expect(pdfString('日')).toBe('(?)');
  });

  it('writes a structurally valid PDF with a correct xref table', () => {
    const pdf = renderPdf([{ text: 'Faktura INV/2026/01043', x: 56, y: 780 }]).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(pdf.slice(off, off + 7)).toBe(`${i + 1} 0 obj`));
  });
});
