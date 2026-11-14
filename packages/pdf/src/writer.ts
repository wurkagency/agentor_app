import { createHash } from 'node:crypto';

/**
 * A small PDF 1.4 writer (no dependency): A4 pages with text in the four standard fonts
 * (Helvetica, Helvetica-Bold, Courier, Courier-Bold, WinAnsi encoding, which covers Danish), filled
 * and rounded rectangles, lines and SVG paths. Coordinates are CSS pixels at 96 dpi from the
 * top-left, as on the I01/I02 boards (794 × 1123 px); they are converted to points here.
 * Nothing is compressed, so the text stays searchable and testable.
 */

export const PAGE_W = 794;
export const PAGE_H = 1123;
const PT = 0.75; // 1 px at 96 dpi = 0.75 pt

export type FontName = 'regular' | 'bold' | 'mono' | 'monoBold';
const FONT_REF: Record<FontName, string> = {
  regular: 'F1',
  bold: 'F2',
  mono: 'F3',
  monoBold: 'F4',
};
const FONT_BASE: Record<FontName, string> = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  mono: 'Courier',
  monoBold: 'Courier-Bold',
};

/* ---- Text encoding and metrics -------------------------------------------------------------- */

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80,
  '…': 0x85,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '›': 0x9b,
  // The typographic minus and arrows are outside WinAnsi; their closest glyphs.
  '−': 0x96,
  '→': 0x9b,
};

/** Encodes text as a PDF literal string in WinAnsi; unsupported characters become "?". */
export function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (WIN_ANSI_EXTRA[ch] !== undefined) byte = WIN_ANSI_EXTRA[ch];
    else if (code === 0xa0 || code === 0x202f) byte = 0x20;
    else if (code < 0x20) byte = 0x20;
    else if (code <= 0xff) byte = code;
    else byte = 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x80) out += String.fromCharCode(byte);
    else out += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `(${out})`;
}

/* Helvetica and Helvetica-Bold glyph widths (Adobe AFM, 1/1000 em) for ASCII 32–126; other
 * characters use the few below or 556. Courier is fixed at 600. */
const ASCII_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ASCII_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const EXTRA: Record<string, [number, number]> = {
  æ: [889, 889],
  ø: [611, 611],
  å: [556, 556],
  Æ: [1000, 1000],
  Ø: [778, 778],
  Å: [667, 722],
  é: [556, 556],
  ö: [556, 611],
  ü: [556, 611],
  ä: [556, 556],
  '·': [278, 278],
  '–': [556, 556],
  '−': [556, 556],
  '—': [1000, 1000],
  '×': [584, 584],
  '€': [556, 556],
  '…': [1000, 1000],
  '•': [350, 350],
  '’': [222, 278],
  '›': [333, 333],
  '→': [333, 333],
  '\u00a0': [278, 278],
  '\u202f': [278, 278],
};

/** Width of a text in the same unit as `size` (px or pt). */
export function textWidth(
  text: string,
  size: number,
  font: FontName | boolean = 'regular',
): number {
  const f: FontName = font === true ? 'bold' : font === false ? 'regular' : font;
  if (f === 'mono' || f === 'monoBold') return [...text].length * 0.6 * size;
  const bold = f === 'bold';
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const table = bold ? ASCII_BOLD : ASCII_REGULAR;
    w += code >= 32 && code <= 126 ? table[code - 32]! : (EXTRA[ch]?.[bold ? 1 : 0] ?? 556);
  }
  return (w * size) / 1000;
}

/** Splits text into lines no wider than `width` (at word boundaries; long words are cut). */
export function wrap(
  text: string,
  width: number,
  size: number,
  font: FontName = 'regular',
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, font) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (textWidth(rest, size, font) > width) {
        let cut = rest.length;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, font) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/* ---- Colours --------------------------------------------------------------------------------- */

export type Rgb = readonly [number, number, number];
export const hex = (h: string): Rgb => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgb = (c: Rgb) => c.map((v) => v.toFixed(3)).join(' ');

/* ---- Pages ----------------------------------------------------------------------------------- */

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const X = (px: number) => n(px * PT);
const Y = (px: number) => n((PAGE_H - px) * PT);

export interface TextOpts {
  size: number;
  font?: FontName;
  color?: Rgb;
  align?: 'left' | 'right' | 'center';
  /** Extra space between letters, in px (CSS letter-spacing). */
  tracking?: number;
}

/** One page: drawing operations in px from the top-left. */
export class Page {
  readonly ops: string[] = [];
  /** Plain text in reading order, for tests and accessibility of the content. */
  readonly textRuns: string[] = [];

  /** Text with its baseline at `y`. */
  text(s: string, x: number, y: number, o: TextOpts): void {
    if (!s) return;
    const font = o.font ?? 'regular';
    const tracking = o.tracking ?? 0;
    const w = textWidth(s, o.size, font) + tracking * Math.max(0, [...s].length - 1);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const tc = tracking ? ` ${n(tracking * PT)} Tc` : '';
    this.ops.push(
      `BT ${rgb(o.color ?? [0, 0, 0])} rg /${FONT_REF[font]} ${n(o.size * PT)} Tf${tc} ${X(left)} ${Y(y)} Td ${pdfString(s)} Tj${tracking ? ' 0 Tc' : ''} ET`,
    );
    this.textRuns.push(s);
  }

  /** Filled (and/or stroked) rectangle, optionally with rounded corners. */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { fill?: Rgb; stroke?: Rgb; lineWidth?: number; radius?: number },
  ): void {
    const r = Math.min(o.radius ?? 0, w / 2, h / 2);
    const k = 0.5523 * r;
    let path: string;
    if (r <= 0) path = `${X(x)} ${Y(y + h)} ${n(w * PT)} ${n(h * PT)} re`;
    else {
      const p = (px: number, py: number) => `${X(px)} ${Y(py)}`;
      path = [
        `${p(x + r, y)} m`,
        `${p(x + w - r, y)} l`,
        `${p(x + w - r + k, y)} ${p(x + w, y + r - k)} ${p(x + w, y + r)} c`,
        `${p(x + w, y + h - r)} l`,
        `${p(x + w, y + h - r + k)} ${p(x + w - r + k, y + h)} ${p(x + w - r, y + h)} c`,
        `${p(x + r, y + h)} l`,
        `${p(x + r - k, y + h)} ${p(x, y + h - r + k)} ${p(x, y + h - r)} c`,
        `${p(x, y + r)} l`,
        `${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)} c`,
        'h',
      ].join(' ');
    }
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.ops.push(
      `q ${o.fill ? `${rgb(o.fill)} rg ` : ''}${o.stroke ? `${rgb(o.stroke)} RG ${n((o.lineWidth ?? 1) * PT)} w ` : ''}${path} ${paint} Q`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { color: Rgb; width: number }): void {
    this.ops.push(
      `q ${rgb(o.color)} RG ${n(o.width * PT)} w ${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S Q`,
    );
  }

  /** An SVG path (M L H V C S Z, absolute and relative) scaled into a box at (x, y). */
  svgPath(
    d: string,
    o: { x: number; y: number; scale: number; fill?: Rgb; stroke?: Rgb; lineWidth?: number },
  ): void {
    const tx = (vx: number) => X(o.x + vx * o.scale);
    const ty = (vy: number) => Y(o.y + vy * o.scale);
    const out: string[] = [];
    const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
    let i = 0;
    let cmd = '';
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let lastC: [number, number] | null = null;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        out.push('h');
        cx = sx;
        cy = sy;
        lastC = null;
        continue;
      }
      if (C === 'M' || C === 'L') {
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        out.push(`${tx(x)} ${ty(y)} ${C === 'M' ? 'm' : 'l'}`);
        if (C === 'M') {
          sx = x;
          sy = y;
          cmd = rel ? 'l' : 'L'; // further pairs are line-tos
        }
        cx = x;
        cy = y;
        lastC = null;
      } else if (C === 'H') {
        cx = num() + (rel ? cx : 0);
        out.push(`${tx(cx)} ${ty(cy)} l`);
        lastC = null;
      } else if (C === 'V') {
        cy = num() + (rel ? cy : 0);
        out.push(`${tx(cx)} ${ty(cy)} l`);
        lastC = null;
      } else if (C === 'C' || C === 'S') {
        let x1: number;
        let y1: number;
        if (C === 'C') {
          x1 = num() + (rel ? cx : 0);
          y1 = num() + (rel ? cy : 0);
        } else {
          // Reflection of the previous control point.
          x1 = lastC ? 2 * cx - lastC[0] : cx;
          y1 = lastC ? 2 * cy - lastC[1] : cy;
        }
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        out.push(`${tx(x1)} ${ty(y1)} ${tx(x2)} ${ty(y2)} ${tx(x)} ${ty(y)} c`);
        lastC = [x2, y2];
        cx = x;
        cy = y;
      } else throw new Error(`Unsupported SVG path command ${cmd}`);
    }
    const paint = o.fill ? 'f' : 'S';
    this.ops.push(
      `q ${o.fill ? `${rgb(o.fill)} rg ` : ''}${o.stroke ? `${rgb(o.stroke)} RG ${n((o.lineWidth ?? 1) * PT)} w 1 J 1 j ` : ''}${out.join(' ')} ${paint} Q`,
    );
  }
}

export interface DocInfo {
  title: string;
  author: string;
  subject?: string;
  /** Fixed creation date: the same input always gives the same bytes (immutable documents). */
  created: Date;
}

const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

/** Writes the pages as one PDF. Deterministic: the same pages and info give the same bytes. */
export function renderDocument(pages: Page[], info: DocInfo): Buffer {
  const list = pages.length ? pages : [new Page()];
  // 1 catalog, 2 pages, 3–6 fonts, 7 info, then a page and its content per page.
  const pageId = (i: number) => 8 + i * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${list.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${list.length} >>`,
    ...(['regular', 'bold', 'mono', 'monoBold'] as FontName[]).map(
      (f) =>
        `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE[f]} /Encoding /WinAnsiEncoding >>`,
    ),
    `<< /Title ${pdfString(info.title)} /Author ${pdfString(info.author)}${info.subject ? ` /Subject ${pdfString(info.subject)}` : ''} /Producer (Agentor) /CreationDate (${pdfDate(info.created)}) >>`,
  ];
  const fonts = '/Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>';
  list.forEach((p, i) => {
    const content = p.ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W * PT)} ${n(PAGE_H * PT)}] /Resources << ${fonts} >> /Contents ${pageId(i) + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
  });
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const id = createHash('md5').update(pdf, 'latin1').digest('hex');
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** The text of a PDF made by renderDocument, in drawing order (tests). */
export function pdfText(pdf: Buffer): string[] {
  const s = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/\((?:[^()\\]|\\.)*\) Tj/g)) {
    const lit = m[0].slice(1, -4);
    out.push(
      lit
        .replace(/\\([0-7]{3})/g, (_, o: string) => {
          const b = parseInt(o, 8);
          const rev = Object.entries(WIN_ANSI_EXTRA).find(([, v]) => v === b)?.[0];
          return rev ?? String.fromCharCode(b);
        })
        .replace(/\\([()\\])/g, '$1'),
    );
  }
  return out;
}
