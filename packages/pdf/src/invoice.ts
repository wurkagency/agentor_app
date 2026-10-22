import { formatMessage } from '@agentor/core';
import { formatDate, formatMinutes, formatNumber, type Locale } from '@agentor/i18n';
import da from '@agentor/i18n/messages/da.json' with { type: 'json' };
import en from '@agentor/i18n/messages/en.json' with { type: 'json' };
import { LOGO_PATHS, LOGO_VIEWBOX } from './logo.js';
import {
  hex,
  Page,
  PAGE_H,
  PAGE_W,
  renderDocument,
  textWidth,
  wrap,
  type FontName,
  type Rgb,
} from './writer.js';

/**
 * The invoice (I01) and credit note (I02) as A4 PDFs, laid out as on the boards: logo and
 * Agentor's details, the lime FAKTURA or navy KREDITNOTA pill with the number in mono, the
 * parties, the line table (repeated heading on every page), totals with 25 % VAT, a status box,
 * notes and a footer with the company and bank details and "Side x af y". Support invoices can
 * carry the time log as an appendix. Agentor's own details come from platform settings; empty
 * ones print as the boards' placeholders.
 */

export interface SellerDetails {
  name: string;
  address: string | null;
  postalCity: string | null;
  cvr: string | null;
  email: string;
  web: string;
  bankReg: string | null;
  bankAccount: string | null;
  iban: string | null;
}

export interface Party {
  name: string;
  addressLines: string[];
  cvr: string | null;
  email: string | null;
}

export interface DocumentLine {
  /** "#2271", printed bold before the title (support cases). */
  ref?: string | null;
  title: string;
  detail?: string | null;
  /** Hours for support lines (from minutes), pieces otherwise. */
  quantity: { hours: number } | { pieces: number };
  /** Net unit price in øre; null leaves the column empty. */
  unitPriceOre: number | null;
  /** Net amount in øre (negative on credit notes). */
  amountOre: number;
}

export type InvoiceVariant =
  | {
      kind: 'subscription';
      plan: string;
      interval: 'month' | 'year';
      periodStart: Date;
      /** Last day of the period (inclusive). */
      periodEnd: Date;
    }
  | { kind: 'support'; month: Date; rateOre: number };

export type InvoicePayment =
  | { method: 'card'; state: 'paid'; card: string | null; paidAt: Date; transaction: string | null }
  | { method: 'card'; state: 'open' | 'failed'; card: string | null; dueAt: Date }
  | { method: 'invoice'; ean: string | null; dueAt: Date };

export interface TimelogRow {
  date: Date;
  caseLabel: string;
  registeredMinutes: number;
  billedMinutes: number;
}

export interface InvoiceInput {
  locale?: Locale;
  number: string;
  issuedAt: Date;
  dueAt: Date | null;
  customerNumber: string;
  seller: SellerDetails;
  customer: Party;
  variant: InvoiceVariant;
  lines: DocumentLine[];
  netOre: number;
  vatOre: number;
  payment: InvoicePayment;
  timelog?: TimelogRow[] | null;
}

export interface CreditNoteInput {
  locale?: Locale;
  number: string;
  issuedAt: Date;
  customerNumber: string;
  seller: SellerDetails;
  customer: Party;
  invoice: { number: string; issuedAt: Date; afterGrossOre: number };
  reason: string;
  createdBy: string;
  lines: DocumentLine[];
  netOre: number;
  vatOre: number;
  refund:
    | { method: 'card'; state: 'done' | 'pending' | 'failed'; card: string | null; at: Date | null }
    | { method: 'offset' };
}

export class DocumentTotalsError extends Error {
  constructor(lines: number, net: number) {
    super(`Lines add up to ${lines} øre, the document says ${net} øre`);
    this.name = 'DocumentTotalsError';
  }
}

/* ---- Copy and formatting ----------------------------------------------------------------------- */

type Tree = { [k: string]: string | Tree };
const COPY: Record<Locale, Tree> = {
  da: (da as unknown as { pdf: Tree }).pdf,
  en: (en as unknown as { pdf: Tree }).pdf,
};

function tr(locale: Locale) {
  return (key: string, params: Record<string, string | number> = {}) => {
    let node: string | Tree | undefined = COPY[locale];
    for (const k of key.split('.')) node = typeof node === 'object' ? node[k] : undefined;
    if (typeof node !== 'string') throw new Error(`Missing PDF copy ${locale}:pdf.${key}`);
    return formatMessage(node, params);
  };
}

/** Øre → "1.440,00" (table) or "1.440,00 kr." (totals); negatives with a real minus. */
function amount(locale: Locale, ore: number, kr = false): string {
  const s = formatNumber(Math.abs(ore) / 100, locale, 2);
  const sign = ore < 0 ? '−' : '';
  return kr ? (locale === 'da' ? `${sign}${s} kr.` : `${sign}DKK ${s}`) : `${sign}${s}`;
}

/* ---- Layout ------------------------------------------------------------------------------------- */

const COL = {
  fg: hex('#1A1A18'),
  muted: hex('#6B6B67'),
  rule: hex('#E4E1DB'),
  soft: hex('#F7F5F1'),
  chip: hex('#F0EDE8'),
  lime: hex('#D0E84A'),
  navy: hex('#13293A'),
  white: hex('#FFFFFF'),
  infoBg: hex('#E5EDF5'),
  info: hex('#2B5C8A'),
  warnBg: hex('#FBE7E4'),
  warn: hex('#B42318'),
};

const LEFT = 60;
const RIGHT = PAGE_W - 60;
const WIDTH = RIGHT - LEFT;
const TOP = 56;
const BOTTOM = PAGE_H - 40;

/** CSS-like baseline: top of the line box + half-leading + ascent. */
const baseline = (top: number, size: number, lineHeight: number) =>
  top + (lineHeight - size) / 2 + size * 0.78;

interface Run {
  text: string;
  font?: FontName;
  color?: Rgb;
}

/** Draws runs one after another on one line, from x. Returns the end x. */
function runs(page: Page, list: Run[], x: number, y: number, size: number): number {
  let cx = x;
  for (const r of list) {
    const font = r.font ?? 'regular';
    page.text(r.text, cx, y, { size, font, color: r.color ?? COL.fg });
    cx += textWidth(r.text, size, font);
  }
  return cx;
}

type Icon = 'check' | 'clock' | 'info' | 'alert';
const ICON: Record<Icon, string[]> = {
  check: ['M20 6 9 17l-5-5'],
  clock: ['M12 6V12L16 14'],
  info: ['M12 16v-4', 'M12 8h.01'],
  alert: ['M12 8v4', 'M12 16h.01'],
};

function icon(page: Page, kind: Icon, x: number, y: number, bg: Rgb, fg: Rgb) {
  page.rect(x, y, 28, 28, { fill: bg, radius: 14 });
  // The 24 px icon at 16 px, centred in the 28 px circle.
  const s = 16 / 24;
  if (kind !== 'check')
    page.rect(x + 6 + 2 * s, y + 6 + 2 * s, 20 * s, 20 * s, {
      stroke: fg,
      lineWidth: 2 * s,
      radius: 10 * s,
    });
  for (const d of ICON[kind])
    page.svgPath(d, {
      x: x + 6,
      y: y + 6,
      scale: s,
      stroke: fg,
      lineWidth: kind === 'check' ? 2.2 * s : 2 * s,
    });
}

interface Header {
  pill: string;
  pillFill: Rgb;
  pillText: Rgb;
  title: string;
  number: string;
  meta: [string, string][];
}

interface Layout {
  t: ReturnType<typeof tr>;
  locale: Locale;
  seller: SellerDetails;
  header: Header;
}

/** Logo and Agentor's details (left), pill, number and meta (right). Returns the bottom. */
function drawHeader(page: Page, l: Layout): number {
  const { t, seller, header } = l;
  const scale = 26 / LOGO_VIEWBOX.height;
  for (const d of LOGO_PATHS) page.svgPath(d, { x: LEFT, y: TOP, scale, fill: COL.fg });
  const sellerLines = [
    seller.name,
    seller.address || t('placeholder.address'),
    seller.postalCity || t('placeholder.postalCity'),
    t('cvr', { cvr: seller.cvr || t('placeholder.cvr') }),
    `${seller.email} · ${seller.web}`,
  ];
  const lh = 11 * 1.55;
  sellerLines.forEach((s, i) =>
    page.text(s, LEFT, baseline(TOP + 40 + i * lh, 11, lh), { size: 11, color: COL.muted }),
  );
  const leftBottom = TOP + 40 + sellerLines.length * lh;

  // Pill: 26 px high, 12 px padding, 11 px bold upper case with 0.08 em tracking.
  const label = header.pill.toUpperCase();
  const tracking = 11 * 0.08;
  const pillW = textWidth(label, 11, 'bold') + tracking * (label.length - 1) + 24;
  page.rect(RIGHT - pillW, TOP, pillW, 26, { fill: header.pillFill, radius: 13 });
  page.text(label, RIGHT - pillW + 12, baseline(TOP, 11, 26), {
    size: 11,
    font: 'bold',
    color: header.pillText,
    tracking,
  });
  const numberTop = TOP + 26 + 10;
  page.text(header.number, RIGHT, baseline(numberTop, 28, 33.6), {
    size: 28,
    font: 'monoBold',
    color: COL.fg,
    align: 'right',
  });
  let y = numberTop + 33.6 + 10;
  const valueW = Math.max(...header.meta.map(([, v]) => textWidth(v, 11.5, 'bold')));
  const labelW = Math.max(...header.meta.map(([k]) => textWidth(k, 11.5)));
  for (const [k, v] of header.meta) {
    const b = baseline(y + 3, 11.5, 13.8);
    page.text(k, RIGHT - valueW - 16 - labelW, b, { size: 11.5, color: COL.muted });
    page.text(v, RIGHT, b, { size: 11.5, font: 'bold', color: COL.fg, align: 'right' });
    y += 19.8;
  }
  return Math.max(leftBottom, y);
}

/** "Faktura INV/2026/01043 (fortsat)" on later pages. Returns the bottom. */
function drawShortHeader(page: Page, l: Layout): number {
  const scale = 26 / LOGO_VIEWBOX.height;
  for (const d of LOGO_PATHS) page.svgPath(d, { x: LEFT, y: TOP, scale, fill: COL.fg });
  page.text(
    l.t('continued', { title: l.header.title, number: l.header.number }),
    RIGHT,
    baseline(TOP, 11.5, 26),
    { size: 11.5, color: COL.muted, align: 'right' },
  );
  return TOP + 26 + 30;
}

/** Two columns: "Faktureres til" and "Vedrørende" (or "Krediteres til" and "Årsag"). */
function drawParties(page: Page, top: number, cols: { label: string; lines: Run[][] }[]): number {
  const colW = (WIDTH - 40) / 2;
  let bottom = top;
  cols.forEach((c, i) => {
    const x = LEFT + i * (colW + 40);
    page.text(c.label.toUpperCase(), x, baseline(top, 10, 12), {
      size: 10,
      font: 'bold',
      color: COL.muted,
      tracking: 0.8,
    });
    const lh = 13 * 1.55;
    let y = top + 12 + 6;
    for (const line of c.lines) {
      // Long lines (a reason) wrap within the column.
      const text = line.map((r) => r.text).join('');
      if (line.length === 1 && textWidth(text, 13, line[0]!.font) > colW) {
        for (const part of wrap(text, colW, 13, line[0]!.font ?? 'regular')) {
          runs(page, [{ ...line[0]!, text: part }], x, baseline(y, 13, lh), 13);
          y += lh;
        }
      } else {
        runs(page, line, x, baseline(y, 13, lh), 13);
        y += lh;
      }
    }
    bottom = Math.max(bottom, y);
  });
  return bottom;
}

interface TableCols {
  qtyW: number;
  priceW: number;
  amountW: number;
}

function columns(l: Layout, rows: { qty: string; price: string; amount: string }[]): TableCols {
  const head = (k: string) =>
    textWidth(l.t(k).toUpperCase(), 10, 'bold') + 10 * 0.06 * l.t(k).length;
  return {
    qtyW: 12 + Math.max(head('quantity'), ...rows.map((r) => textWidth(r.qty, 12))),
    priceW: 12 + Math.max(head('price'), ...rows.map((r) => textWidth(r.price, 12))),
    amountW: 12 + Math.max(head('amount'), ...rows.map((r) => textWidth(r.amount, 12))),
  };
}

function drawTableHead(page: Page, l: Layout, top: number, c: TableCols): number {
  const y = baseline(top, 10, 12);
  const o = { size: 10, font: 'bold' as const, color: COL.muted, tracking: 0.6 };
  page.text(l.t('description').toUpperCase(), LEFT, y, o);
  page.text(l.t('quantity').toUpperCase(), RIGHT - c.amountW - c.priceW, y, {
    ...o,
    align: 'right',
  });
  page.text(l.t('price').toUpperCase(), RIGHT - c.amountW, y, { ...o, align: 'right' });
  page.text(l.t('amount').toUpperCase(), RIGHT, y, { ...o, align: 'right' });
  page.line(LEFT, top + 20.75, RIGHT, top + 20.75, { color: COL.fg, width: 1.5 });
  return top + 21.5;
}

interface Row {
  title: Run[];
  detail: string | null;
  qty: string;
  price: string;
  amount: string;
  /** Wrapped detail lines. */
  lines: string[];
  height: number;
}

function prepareRows(l: Layout, lines: DocumentLine[], c: TableCols | null): Row[] {
  const descW = c ? WIDTH - c.qtyW - c.priceW - c.amountW - 12 : WIDTH * 0.6;
  return lines.map((line) => {
    const qty =
      'hours' in line.quantity
        ? l.t('hours', { hours: formatNumber(line.quantity.hours, l.locale, 2).replace(/^-/, '−') })
        : l.t('pieces', { count: formatNumber(line.quantity.pieces, l.locale).replace(/^-/, '−') });
    const title: Run[] = [
      ...(line.ref ? [{ text: `${line.ref} `, font: 'bold' as const }] : []),
      { text: line.title, font: 'bold' as const },
    ];
    const detail = line.detail ?? null;
    const titleLines = wrap(title.map((r) => r.text).join(''), descW, 12, 'bold');
    const detailLines = detail ? wrap(detail, descW, 12) : [];
    const lh = 12 * 1.45;
    return {
      title,
      detail,
      qty,
      price: line.unitPriceOre === null ? '' : amount(l.locale, line.unitPriceOre),
      amount: amount(l.locale, line.amountOre),
      lines: [...titleLines.slice(1), ...detailLines],
      height: 10 + (titleLines.length + detailLines.length) * lh + 10 + 1,
    };
  });
}

function drawRow(page: Page, row: Row, top: number, c: TableCols): number {
  const lh = 12 * 1.45;
  const descW = WIDTH - c.qtyW - c.priceW - c.amountW - 12;
  const y0 = baseline(top + 10, 12, lh);
  const titleText = row.title.map((r) => r.text).join('');
  const titleLines = wrap(titleText, descW, 12, 'bold');
  page.text(titleLines[0]!, LEFT, y0, { size: 12, font: 'bold', color: COL.fg });
  let y = y0;
  for (const extra of titleLines.slice(1)) {
    y += lh;
    page.text(extra, LEFT, y, { size: 12, font: 'bold', color: COL.fg });
  }
  if (row.detail)
    for (const d of wrap(row.detail, descW, 12)) {
      y += lh;
      page.text(d, LEFT, y, { size: 12, color: COL.muted });
    }
  page.text(row.qty, RIGHT - c.amountW - c.priceW, y0, { size: 12, color: COL.fg, align: 'right' });
  page.text(row.price, RIGHT - c.amountW, y0, { size: 12, color: COL.fg, align: 'right' });
  page.text(row.amount, RIGHT, y0, { size: 12, color: COL.fg, align: 'right' });
  const bottom = top + row.height;
  page.line(LEFT, bottom - 0.5, RIGHT, bottom - 0.5, { color: COL.rule, width: 1 });
  return bottom;
}

const TOTALS_H = 18 + 26.4 * 2 + 11.5 + 33.6;

function drawTotals(
  page: Page,
  l: Layout,
  top: number,
  rows: [string, string][],
  total: [string, string],
): number {
  const x = RIGHT - 300;
  let y = top + 18;
  for (const [k, v] of rows) {
    const b = baseline(y + 6, 12, 14.4);
    page.text(k, x, b, { size: 12, color: COL.muted });
    page.text(v, RIGHT, b, { size: 12, color: COL.fg, align: 'right' });
    y += 26.4;
  }
  page.line(x, y + 6.75, RIGHT, y + 6.75, { color: COL.fg, width: 1.5 });
  y += 11.5;
  page.text(total[0], x, baseline(y + 6, 14, 21.6), { size: 14, font: 'bold', color: COL.fg });
  page.text(total[1], RIGHT, baseline(y + 6, 18, 21.6), {
    size: 18,
    font: 'bold',
    color: COL.fg,
    align: 'right',
  });
  return y + 33.6;
}

interface StatusBox {
  icon: Icon;
  iconBg: Rgb;
  iconFg: Rgb;
  title: string;
  text: string;
  sub: string | null;
}

function statusHeight(s: StatusBox): number {
  const w = WIDTH - 32 - 40;
  const lines =
    wrap(`${s.title} ${s.text}`, w, 12).length + (s.sub ? wrap(s.sub, w, 12).length : 0);
  return 28 + 28 + lines * 17.4;
}

function drawStatus(page: Page, top: number, s: StatusBox): number {
  const h = statusHeight(s) - 28;
  const y = top + 28;
  page.rect(LEFT, y, WIDTH, h, { fill: COL.soft, radius: 12 });
  icon(page, s.icon, LEFT + 16, y + (h - 28) / 2, s.iconBg, s.iconFg);
  const x = LEFT + 16 + 28 + 12;
  const w = WIDTH - 32 - 40;
  const lh = 17.4;
  let ly = y + 14;
  // The first line starts with the bold word ("Betalt"); wrap the rest after it.
  const lines = wrap(`${s.title} ${s.text}`, w, 12);
  lines.forEach((line, i) => {
    const b = baseline(ly, 12, lh);
    if (i === 0 && line.startsWith(s.title)) {
      runs(page, [{ text: s.title, font: 'bold' }, { text: line.slice(s.title.length) }], x, b, 12);
    } else page.text(line, x, b, { size: 12, color: COL.fg });
    ly += lh;
  });
  if (s.sub)
    for (const line of wrap(s.sub, w, 12)) {
      page.text(line, x, baseline(ly, 12, lh), { size: 12, color: COL.muted });
      ly += lh;
    }
  return y + h;
}

/** Notes above the footer and the footer itself; returns the top of the notes. */
function drawFoot(
  page: Page,
  l: Layout,
  notes: string | null,
  pageNo: number,
  pages: number,
): void {
  const { t, seller } = l;
  const footerTop = BOTTOM - 14.25 - 12;
  page.line(LEFT, footerTop, RIGHT, footerTop, { color: COL.rule, width: 1 });
  const fy = baseline(footerTop + 12, 9.5, 14.25);
  const parts = [
    t('footerCompany', {
      name: seller.name,
      cvr: seller.cvr || t('placeholder.cvr'),
      address:
        [seller.address, seller.postalCity].filter(Boolean).join(', ') || t('placeholder.address'),
    }),
    t('footerBank', {
      reg: seller.bankReg || t('placeholder.reg'),
      account: seller.bankAccount || t('placeholder.account'),
      iban: seller.iban || t('placeholder.iban'),
    }),
    t('page', { page: pageNo, pages }),
  ];
  const widths = parts.map((p) => textWidth(p, 9.5));
  const gap = (WIDTH - widths.reduce((a, w) => a + w, 0)) / 2;
  page.text(parts[0]!, LEFT, fy, { size: 9.5, color: COL.muted });
  page.text(parts[1]!, LEFT + widths[0]! + gap, fy, { size: 9.5, color: COL.muted });
  page.text(parts[2]!, RIGHT, fy, { size: 9.5, color: COL.muted, align: 'right' });
  if (notes) {
    const lines = wrap(notes, WIDTH, 10.5);
    const lh = 10.5 * 1.55;
    let y = footerTop - 18 - lines.length * lh;
    for (const line of lines) {
      page.text(line, LEFT, baseline(y, 10.5, lh), { size: 10.5, color: COL.muted });
      y += lh;
    }
  }
}

const notesHeight = (notes: string | null) =>
  notes ? wrap(notes, WIDTH, 10.5).length * 10.5 * 1.55 + 18 : 0;
const FOOT_TOP = BOTTOM - 14.25 - 12;

interface Body {
  layout: Layout;
  parties: { label: string; lines: Run[][] }[];
  lines: DocumentLine[];
  totals: [string, string][];
  total: [string, string];
  status: StatusBox;
  notes: string | null;
  timelog: TimelogRow[] | null;
  info: { title: string; subject: string; created: Date };
}

/** Pages: header and parties, rows with the heading repeated, totals and status, appendix. */
function compose(b: Body): Buffer {
  const l = b.layout;
  const pre = prepareRows(l, b.lines, null);
  const cols = columns(l, pre);
  const rows = prepareRows(l, b.lines, cols);
  const pages: { page: Page; notes: string | null }[] = [];
  const contentBottom = (notes: string | null) => FOOT_TOP - notesHeight(notes) - 12;

  let page = new Page();
  pages.push({ page, notes: b.notes });
  let y = drawHeader(page, l);
  y = drawParties(page, y + 40, b.parties);
  y = drawTableHead(page, l, y + 36, cols);
  const tailH = TOTALS_H + statusHeight(b.status);
  rows.forEach((row, i) => {
    const last = i === rows.length - 1;
    const need = row.height + (last ? tailH : 0);
    if (y + need > contentBottom(b.notes) && y + row.height > contentBottom(b.notes)) {
      page = new Page();
      pages.push({ page, notes: b.notes });
      y = drawTableHead(page, l, drawShortHeader(page, l), cols);
    }
    y = drawRow(page, row, y, cols);
  });
  if (y + tailH > contentBottom(b.notes)) {
    page = new Page();
    pages.push({ page, notes: b.notes });
    y = drawShortHeader(page, l);
  }
  y = drawTotals(page, l, y, b.totals, b.total);
  drawStatus(page, y, b.status);

  if (b.timelog?.length) {
    const t = l.t;
    const tl = b.timelog;
    const caseW = WIDTH * 0.46;
    const startAppendix = () => {
      const p = new Page();
      pages.push({ page: p, notes: null });
      let top = drawShortHeader(p, l);
      p.text(t('timelog.title'), LEFT, baseline(top, 16, 20), {
        size: 16,
        font: 'bold',
        color: COL.fg,
      });
      top += 24;
      p.text(t('timelog.intro'), LEFT, baseline(top, 11, 17), { size: 11, color: COL.muted });
      return { p, top: top + 17 + 16 };
    };
    const head = (p: Page, top: number) => {
      const yb = baseline(top, 10, 12);
      const o = { size: 10, font: 'bold' as const, color: COL.muted, tracking: 0.6 };
      p.text(t('timelog.date').toUpperCase(), LEFT, yb, o);
      p.text(t('timelog.case').toUpperCase(), LEFT + 110, yb, o);
      p.text(t('timelog.registered').toUpperCase(), RIGHT - 120, yb, { ...o, align: 'right' });
      p.text(t('timelog.billed').toUpperCase(), RIGHT, yb, { ...o, align: 'right' });
      p.line(LEFT, top + 20.75, RIGHT, top + 20.75, { color: COL.fg, width: 1.5 });
      return top + 21.5;
    };
    let { p, top } = startAppendix();
    top = head(p, top);
    for (const r of tl) {
      const caseLines = wrap(r.caseLabel, caseW, 11);
      const h = 7 + caseLines.length * 16 + 7 + 1;
      if (top + h > FOOT_TOP - 12) {
        ({ p, top } = startAppendix());
        top = head(p, top);
      }
      const yb = baseline(top + 7, 11, 16);
      p.text(formatDate(r.date, l.locale), LEFT, yb, { size: 11, color: COL.fg });
      caseLines.forEach((c, i) => p.text(c, LEFT + 110, yb + i * 16, { size: 11, color: COL.fg }));
      p.text(formatMinutes(r.registeredMinutes, l.locale), RIGHT - 120, yb, {
        size: 11,
        color: COL.muted,
        align: 'right',
      });
      p.text(formatMinutes(r.billedMinutes, l.locale), RIGHT, yb, {
        size: 11,
        color: COL.fg,
        align: 'right',
      });
      top += h;
      p.line(LEFT, top - 0.5, RIGHT, top - 0.5, { color: COL.rule, width: 1 });
    }
  }

  pages.forEach((x, i) => drawFoot(x.page, l, x.notes, i + 1, pages.length));
  return renderDocument(
    pages.map((x) => x.page),
    {
      title: b.info.title,
      author: l.seller.name,
      subject: b.info.subject,
      created: b.info.created,
    },
  );
}

function check(lines: DocumentLine[], netOre: number) {
  const sum = lines.reduce((a, x) => a + x.amountOre, 0);
  if (sum !== netOre) throw new DocumentTotalsError(sum, netOre);
}

const partyLines = (t: ReturnType<typeof tr>, p: Party): Run[][] => [
  [{ text: p.name, font: 'bold' }],
  ...p.addressLines.filter(Boolean).map((a) => [{ text: a }]),
  ...(p.cvr ? [[{ text: t('cvr', { cvr: p.cvr }) }]] : []),
  ...(p.email ? [[{ text: p.email }]] : []),
];

/* ---- I01 ------------------------------------------------------------------------------------- */

export function invoicePdf(i: InvoiceInput): Buffer {
  check(i.lines, i.netOre);
  const locale = i.locale ?? 'da';
  const t = tr(locale);
  const date = (d: Date) => formatDate(d, locale);
  const monthYear = (d: Date) => {
    const s = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Copenhagen',
    }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const v = i.variant;
  const period =
    v.kind === 'support' ? monthYear(v.month) : `${date(v.periodStart)} – ${date(v.periodEnd)}`;
  const about: Run[][] =
    v.kind === 'support'
      ? [
          [{ text: t('support.about', { period: monthYear(v.month).toLowerCase() }) }],
          [{ text: t('support.aboutRule') }],
          [{ text: t('support.aboutRate', { rate: amount(locale, v.rateOre, true) }) }],
        ]
      : [
          [{ text: t('subscription.about', { plan: v.plan }) }],
          [{ text: t('subscription.aboutInterval', { interval: v.interval }) }],
        ];
  const p = i.payment;
  const status: StatusBox =
    p.method === 'card' && p.state === 'paid'
      ? {
          icon: 'check',
          iconBg: COL.chip,
          iconFg: COL.fg,
          title: t('status.paidTitle'),
          text: t('status.paid', { card: p.card ?? 'kort', date: date(p.paidAt) }),
          sub: p.transaction ? t('status.transaction', { id: p.transaction }) : null,
        }
      : p.method === 'card'
        ? p.state === 'failed'
          ? {
              icon: 'alert',
              iconBg: COL.warnBg,
              iconFg: COL.warn,
              title: t('status.cardFailedTitle'),
              text: t('status.cardFailed', { card: p.card ?? 'kort' }),
              sub: null,
            }
          : {
              icon: 'clock',
              iconBg: COL.chip,
              iconFg: COL.fg,
              title: t('status.cardTitle'),
              text: t('status.card', { card: p.card ?? 'kort', date: date(p.dueAt) }),
              sub: null,
            }
        : {
            icon: 'clock',
            iconBg: COL.chip,
            iconFg: COL.fg,
            title: p.ean ? t('status.eanTitle') : t('status.bankTitle'),
            text: p.ean
              ? t('status.ean', { date: date(p.dueAt), ean: p.ean })
              : t('status.bank', {
                  date: date(p.dueAt),
                  reg: i.seller.bankReg || t('placeholder.reg'),
                  account: i.seller.bankAccount || t('placeholder.account'),
                  iban: i.seller.iban || t('placeholder.iban'),
                  number: i.number,
                }),
            sub: p.ean
              ? t('status.bank', {
                  date: date(p.dueAt),
                  reg: i.seller.bankReg || t('placeholder.reg'),
                  account: i.seller.bankAccount || t('placeholder.account'),
                  iban: i.seller.iban || t('placeholder.iban'),
                  number: i.number,
                }).replace(/^[^.]*\.\s*/, '')
              : null,
          };
  const layout: Layout = {
    t,
    locale,
    seller: i.seller,
    header: {
      pill: t('invoice'),
      pillFill: COL.lime,
      pillText: COL.fg,
      title: t('invoice'),
      number: i.number,
      meta: [
        [t('invoiceDate'), date(i.issuedAt)],
        ...(i.dueAt ? ([[t('due'), date(i.dueAt)]] as [string, string][]) : []),
        [t('period'), period],
        [t('customerNo'), i.customerNumber],
      ],
    },
  };
  return compose({
    layout,
    parties: [
      { label: t('billedTo'), lines: partyLines(t, i.customer) },
      { label: t('about'), lines: about },
    ],
    lines: i.lines,
    totals: [
      [t('subtotal'), amount(locale, i.netOre, true)],
      [t('vat'), amount(locale, i.vatOre, true)],
    ],
    total: [t('total'), amount(locale, i.netOre + i.vatOre, true)],
    status,
    notes: i.timelog?.length
      ? t('notes.timelog', { email: i.seller.email })
      : t('notes.invoice', { email: i.seller.email }),
    timelog: i.timelog ?? null,
    info: { title: `${t('invoice')} ${i.number}`, subject: i.customer.name, created: i.issuedAt },
  });
}

/* ---- I02 ------------------------------------------------------------------------------------- */

export function creditNotePdf(c: CreditNoteInput): Buffer {
  check(c.lines, c.netOre);
  const locale = c.locale ?? 'da';
  const t = tr(locale);
  const date = (d: Date) => formatDate(d, locale);
  const r = c.refund;
  const after = t('status.after', {
    number: c.invoice.number,
    amount: amount(locale, c.invoice.afterGrossOre, true),
  });
  const status: StatusBox =
    r.method === 'offset'
      ? {
          icon: 'info',
          iconBg: COL.infoBg,
          iconFg: COL.info,
          title: t('status.offsetTitle'),
          text: t('status.offset'),
          sub: after,
        }
      : r.state === 'done' && r.at
        ? {
            icon: 'info',
            iconBg: COL.infoBg,
            iconFg: COL.info,
            title: t('status.refundTitle'),
            text: t('status.refund', { card: r.card ?? 'kort', date: date(r.at) }),
            sub: after,
          }
        : {
            icon: 'info',
            iconBg: COL.infoBg,
            iconFg: COL.info,
            title: t('status.refundPendingTitle'),
            text: t('status.refundPending', { card: r.card ?? 'kort' }),
            sub: after,
          };
  const layout: Layout = {
    t,
    locale,
    seller: c.seller,
    header: {
      pill: t('creditNote'),
      pillFill: COL.navy,
      pillText: COL.white,
      title: t('creditNote'),
      number: c.number,
      meta: [
        [t('date'), date(c.issuedAt)],
        [t('credits'), t('creditsValue', { number: c.invoice.number })],
        [t('invoiceDate'), date(c.invoice.issuedAt)],
        [t('customerNo'), c.customerNumber],
      ],
    },
  };
  return compose({
    layout,
    parties: [
      { label: t('creditedTo'), lines: partyLines(t, c.customer) },
      {
        label: t('reason'),
        lines: [
          [{ text: c.reason }],
          [{ text: t('creditedBy', { name: c.createdBy }), color: COL.muted }],
        ],
      },
    ],
    lines: c.lines,
    totals: [
      [t('subtotal'), amount(locale, c.netOre, true)],
      [t('vat'), amount(locale, c.vatOre, true)],
    ],
    total: [t('creditTotal'), amount(locale, c.netOre + c.vatOre, true)],
    status,
    notes: t('notes.creditNote', { email: c.seller.email }),
    timelog: null,
    info: {
      title: `${t('creditNote')} ${c.number}`,
      subject: c.customer.name,
      created: c.issuedAt,
    },
  });
}
