/**
 * Minimal single-page PDF for an invoice (D13 "PDF"). Hand-written PDF 1.4 with the built-in
 * Helvetica fonts in WinAnsi encoding, which covers Danish letters; no dependency needed for a
 * page of text and lines.
 */

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right';
}

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
};

/** Encodes text as a PDF literal string in WinAnsi; unsupported characters become "?". */
export function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (WIN_ANSI_EXTRA[ch] !== undefined) byte = WIN_ANSI_EXTRA[ch];
    else if (code === 0xa0) byte = 0x20;
    else if (code < 0x20) byte = 0x20;
    else if (code <= 0xff) byte = code;
    else byte = 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x80) out += String.fromCharCode(byte);
    else out += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `(${out})`;
}

/** Rough Helvetica width (average glyph 0.52 em) for right alignment. */
function approxWidth(text: string, size: number) {
  return text.length * size * 0.52;
}

export function renderPdf(lines: PdfLine[], rules: { y: number; x1: number; x2: number }[] = []) {
  const ops: string[] = [];
  for (const r of rules) ops.push(`0.85 G 0.5 w ${r.x1} ${r.y} m ${r.x2} ${r.y} l S`);
  ops.push('0 g');
  for (const l of lines) {
    const size = l.size ?? 10;
    const x = l.align === 'right' ? l.x - approxWidth(l.text, size) : l.x;
    ops.push(
      `BT /${l.bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${l.y} Td ${pdfString(l.text)} Tj ET`,
    );
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export interface InvoicePdfInput {
  number: string;
  date: string;
  period: string;
  description: string;
  /** The plan line; support invoices have only their case lines. */
  planAmount?: string;
  extra: { text: string; amount: string }[];
  net: string;
  vat: string;
  total: string;
  status: string;
  customer: { name: string; cvr: string | null; address: string[] };
  /** Support invoices: the time log under the totals (F5 "Vedhæft tidslog"). */
  timelog?: { title: string; rows: { text: string; amount: string }[] };
  labels: {
    invoice: string;
    date: string;
    period: string;
    customer: string;
    description: string;
    amount: string;
    net: string;
    vat: string;
    total: string;
    status: string;
    footer: string;
  };
}

/** Agentor's own sender details. FOLLOW-UP: confirm legal entity and CVR before launch. */
const SELLER = ['Agentor', 'app.agentor.dk', 'faktura@agentor.dk'];

export function invoicePdf(i: InvoicePdfInput): Buffer {
  const L = i.labels;
  const shift = i.extra.length * 16;
  const lines: PdfLine[] = [
    { text: 'Agentor', x: 56, y: 780, size: 22, bold: true },
    { text: `${L.invoice} ${i.number}`, x: 539, y: 784, size: 14, bold: true, align: 'right' },
    ...SELLER.map((s, n) => ({ text: s, x: 56, y: 752 - n * 13, size: 9 })),
    { text: L.customer, x: 56, y: 690, size: 9, bold: true },
    { text: i.customer.name, x: 56, y: 676, size: 10 },
    ...i.customer.address.map((a, n) => ({ text: a, x: 56, y: 663 - n * 13, size: 10 })),
    ...(i.customer.cvr
      ? [
          {
            text: `CVR ${i.customer.cvr}`,
            x: 56,
            y: 663 - i.customer.address.length * 13,
            size: 10,
          },
        ]
      : []),
    { text: `${L.date}: ${i.date}`, x: 539, y: 690, size: 10, align: 'right' },
    { text: `${L.period}: ${i.period}`, x: 539, y: 676, size: 10, align: 'right' },
    { text: `${L.status}: ${i.status}`, x: 539, y: 662, size: 10, align: 'right' },
    { text: L.description, x: 56, y: 590, size: 9, bold: true },
    { text: L.amount, x: 539, y: 590, size: 9, bold: true, align: 'right' },
    ...[
      ...(i.planAmount ? [{ text: i.description, amount: i.planAmount }] : []),
      ...i.extra,
    ].flatMap((row, n) => [
      { text: row.text, x: 56, y: 568 - n * 16, size: 10 },
      { text: row.amount, x: 539, y: 568 - n * 16, size: 10, align: 'right' as const },
    ]),
    { text: L.net, x: 360, y: 530 - shift, size: 10 },
    { text: i.net, x: 539, y: 530 - shift, size: 10, align: 'right' },
    { text: L.vat, x: 360, y: 514 - shift, size: 10 },
    { text: i.vat, x: 539, y: 514 - shift, size: 10, align: 'right' },
    { text: L.total, x: 360, y: 492 - shift, size: 11, bold: true },
    { text: i.total, x: 539, y: 492 - shift, size: 11, bold: true, align: 'right' },
    { text: L.footer, x: 56, y: 80, size: 8 },
  ];
  const rules = [
    { y: 582, x1: 56, x2: 539 },
    { y: 548 - shift, x1: 56, x2: 539 },
    { y: 504 - shift, x1: 360, x2: 539 },
  ];
  if (i.timelog && i.timelog.rows.length) {
    // One page: as many registrations as fit above the footer, then a count of the rest.
    const top = 450 - shift;
    const fit = Math.max(0, Math.floor((top - 110) / 13));
    const rows = i.timelog.rows.slice(0, fit);
    lines.push({ text: i.timelog.title, x: 56, y: top, size: 9, bold: true });
    rules.push({ y: top - 6, x1: 56, x2: 539 });
    rows.forEach((r, n) => {
      lines.push({ text: r.text, x: 56, y: top - 20 - n * 13, size: 9 });
      lines.push({ text: r.amount, x: 539, y: top - 20 - n * 13, size: 9, align: 'right' });
    });
    if (i.timelog.rows.length > rows.length)
      lines.push({
        text: `+ ${i.timelog.rows.length - rows.length}`,
        x: 56,
        y: top - 20 - rows.length * 13,
        size: 9,
      });
  }
  return renderPdf(lines, rules);
}
