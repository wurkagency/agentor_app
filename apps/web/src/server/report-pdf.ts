import { renderPages, textWidth, type PdfLine, type PdfPage } from './invoice-pdf';

/**
 * Report PDFs (A3, A4, F7): title, the key figures and tables that run over as many A4 pages as
 * they need, with the column headings repeated and "Side x af y" at the foot. Built from the same
 * rows as the page and the CSV, so the three always agree.
 */

export interface ReportColumn {
  label: string;
  /** Share of the table width. */
  weight: number;
  align?: 'left' | 'right';
}

export interface ReportTable {
  heading: string;
  columns: ReportColumn[];
  rows: string[][];
  /** A bold last row, e.g. "I alt". */
  total?: string[];
  /** Font size of the rows; 9 unless a wide table needs less. */
  size?: number;
}

export interface ReportPdfInput {
  title: string;
  subtitle: string;
  kpis: { label: string; value: string; sub?: string | undefined }[];
  tables: ReportTable[];
  /** "Side {page} af {pages}" */
  pageLabel: (page: number, pages: number) => string;
  footer: string;
}

const LEFT = 50;
const RIGHT = 545;
const TOP = 790;
const BOTTOM = 60;
const ROW = 14;

/** Cuts a text with "…" so it fits a column. */
function fit(text: string, width: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= width) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}…`, size, bold) > width) s = s.slice(0, -1);
  return `${s}…`;
}

export function reportPdf(r: ReportPdfInput): Buffer {
  const pages: PdfPage[] = [];
  let page: PdfPage = { lines: [], rules: [] };
  let y = TOP;
  const push = (l: PdfLine) => page.lines.push(l);
  const newPage = () => {
    pages.push(page);
    page = { lines: [], rules: [] };
    y = TOP;
  };

  push({ text: 'Agentor', x: LEFT, y, size: 9, bold: true });
  y -= 22;
  push({ text: r.title, x: LEFT, y, size: 16, bold: true });
  y -= 16;
  push({ text: r.subtitle, x: LEFT, y, size: 9 });
  y -= 26;

  // Key figures, two to a row.
  const half = (RIGHT - LEFT) / 2;
  r.kpis.forEach((k, i) => {
    const x = LEFT + (i % 2) * half;
    push({ text: k.label, x, y, size: 8 });
    push({ text: k.value, x, y: y - 15, size: 13, bold: true });
    if (k.sub) push({ text: fit(k.sub, half - 12, 8), x, y: y - 28, size: 8 });
    if (i % 2 === 1 || i === r.kpis.length - 1) y -= 44;
  });
  y -= 6;

  for (const table of r.tables) {
    const total = table.columns.reduce((a, c) => a + c.weight, 0);
    const xs: { x: number; w: number; align: 'left' | 'right' }[] = [];
    let cx = LEFT;
    for (const c of table.columns) {
      const w = ((RIGHT - LEFT) * c.weight) / total;
      xs.push({ x: cx, w, align: c.align ?? 'left' });
      cx += w;
    }
    const cell = (text: string, i: number, size: number, bold = false) => {
      const col = xs[i]!;
      const t = fit(text, col.w - 6, size, bold);
      push(
        col.align === 'right'
          ? { text: t, x: col.x + col.w - 2, y, size, bold, align: 'right' }
          : { text: t, x: col.x, y, size, bold },
      );
    };
    const head = () => {
      table.columns.forEach((c, i) => cell(c.label, i, 8, true));
      page.rules!.push({ y: y - 4, x1: LEFT, x2: RIGHT });
      y -= ROW + 2;
    };
    if (y - 40 < BOTTOM) newPage();
    push({ text: table.heading, x: LEFT, y, size: 11, bold: true });
    y -= 18;
    head();
    const rows = table.total ? [...table.rows, table.total] : table.rows;
    rows.forEach((row, ri) => {
      if (y < BOTTOM) {
        newPage();
        push({ text: table.heading, x: LEFT, y, size: 9, bold: true });
        y -= 16;
        head();
      }
      const bold = Boolean(table.total) && ri === rows.length - 1;
      if (bold) page.rules!.push({ y: y + ROW - 4, x1: LEFT, x2: RIGHT });
      row.forEach((v, i) => cell(v, i, table.size ?? 9, bold));
      y -= ROW;
    });
    y -= 18;
  }
  pages.push(page);
  pages.forEach((p, i) => {
    p.lines.push({ text: r.footer, x: LEFT, y: 34, size: 7 });
    p.lines.push({
      text: r.pageLabel(i + 1, pages.length),
      x: RIGHT,
      y: 34,
      size: 7,
      align: 'right',
    });
  });
  return renderPages(pages);
}

/** The text drawn in a PDF built here, in order (for tests and the e2e check). */
export function pdfTexts(pdf: Buffer): string[] {
  const s = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/\((?:\\.|[^\\)])*\) Tj/g)) {
    const raw = m[0].slice(1, -4);
    out.push(
      raw
        .replace(/\\([0-7]{3})/g, (_, o: string) => {
          const b = parseInt(o, 8);
          const extra: Record<number, string> = {
            0x80: '€',
            0x85: '…',
            0x95: '•',
            0x96: '–',
            0x97: '—',
            0x92: '’',
            0x93: '“',
            0x94: '”',
          };
          return extra[b] ?? String.fromCharCode(b);
        })
        .replace(/\\([()\\])/g, '$1'),
    );
  }
  return out;
}
