/**
 * Customer templates for destination fields (PLAN-INTEGRATIONS-WOO-DINERO §3.3), e.g.
 * `Ordre {order.number} · {order.paymentMethod.title}`. A pure string function with no code
 * execution: the 95 % case without JSONata. Developers use expressions for the rest.
 *
 * Syntax: `{path|filter:arg|filter}`. `{{` and `}}` write literal braces. Filters:
 * `default:<path or "text">`, `date:<dd-MM-yyyy HH:mm>`, `truncate:<n>`, `upper`, `lower`,
 * `trim`, `money` (øre → "4.395,00").
 */

export const TEMPLATE_MAX_LENGTH = 500;

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly code: 'SYNTAX' | 'UNKNOWN_FILTER' | 'BAD_PATH' | 'TOO_LONG',
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

interface Filter {
  name: string;
  arg: string | null;
}

export type TemplatePart = { text: string } | { path: string; filters: Filter[] };

const SEGMENT = /^[A-Za-z_]\w*$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const FILTERS = new Set(['default', 'date', 'truncate', 'upper', 'lower', 'trim', 'money']);

function checkPath(path: string) {
  const parts = path.split('.');
  if (parts.length > 8 || parts.some((p) => !SEGMENT.test(p) || FORBIDDEN.has(p)))
    throw new TemplateError(`invalid variable "${path}"`, 'BAD_PATH');
}

function parseExpression(src: string): TemplatePart {
  const [rawPath = '', ...rawFilters] = src.split('|').map((x) => x.trim());
  checkPath(rawPath);
  const filters = rawFilters.map((f): Filter => {
    const i = f.indexOf(':');
    const name = (i < 0 ? f : f.slice(0, i)).trim();
    const arg = i < 0 ? null : f.slice(i + 1).trim();
    if (!FILTERS.has(name)) throw new TemplateError(`unknown filter "${name}"`, 'UNKNOWN_FILTER');
    if (name === 'default' && arg && !arg.startsWith('"')) checkPath(arg);
    if (name === 'truncate' && !/^\d{1,4}$/.test(arg ?? ''))
      throw new TemplateError('truncate needs a length', 'SYNTAX');
    return { name, arg };
  });
  return { path: rawPath, filters };
}

export function parseTemplate(src: string): TemplatePart[] {
  if (src.length > TEMPLATE_MAX_LENGTH) throw new TemplateError('template too long', 'TOO_LONG');
  const parts: TemplatePart[] = [];
  let text = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '{' && src[i + 1] === '{') {
      text += '{';
      i++;
    } else if (c === '}' && src[i + 1] === '}') {
      text += '}';
      i++;
    } else if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new TemplateError('missing }', 'SYNTAX');
      if (text) parts.push({ text });
      text = '';
      parts.push(parseExpression(src.slice(i + 1, end)));
      i = end;
    } else if (c === '}') {
      throw new TemplateError('unexpected }', 'SYNTAX');
    } else text += c;
  }
  if (text) parts.push({ text });
  return parts;
}

/** Every variable a template reads, including `default:` fallbacks, for validation. */
export function templateVariables(src: string): string[] {
  const out: string[] = [];
  for (const p of parseTemplate(src)) {
    if (!('path' in p)) continue;
    out.push(p.path);
    for (const f of p.filters)
      if (f.name === 'default' && f.arg && !f.arg.startsWith('"')) out.push(f.arg);
  }
  return out;
}

/** Reads `a.b.c` from own properties only, so a template can never reach a prototype. */
export function resolvePath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || FORBIDDEN.has(key)) return undefined;
    if (!Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ');
  return '';
}

const money = new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatDate(value: string, format: string, timeZone: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return format.replace(/yyyy|MM|dd|HH|mm/g, (t) =>
    t === 'yyyy'
      ? parts.year!
      : t === 'MM'
        ? parts.month!
        : t === 'dd'
          ? parts.day!
          : t === 'HH'
            ? parts.hour!
            : parts.minute!,
  );
}

export interface RenderOptions {
  /** Target field's max length (manifest `TargetField.maxLength`). */
  maxLength?: number | undefined;
  /** What to do with a longer value: cut it (default) or fail the record. */
  overflow?: 'truncate' | 'fail';
  timeZone?: string;
}

export function renderTemplate(src: string, ctx: unknown, opts: RenderOptions = {}): string {
  const timeZone = opts.timeZone ?? 'Europe/Copenhagen';
  let out = '';
  for (const part of parseTemplate(src)) {
    if ('text' in part) {
      out += part.text;
      continue;
    }
    let raw = resolvePath(ctx, part.path);
    let value = toText(raw);
    for (const f of part.filters) {
      if (f.name === 'default' && !value) {
        raw = f.arg?.startsWith('"') ? f.arg.replace(/^"|"$/g, '') : resolvePath(ctx, f.arg ?? '');
        value = toText(raw);
      } else if (f.name === 'date') value = formatDate(value, f.arg || 'dd-MM-yyyy', timeZone);
      else if (f.name === 'truncate') value = [...value].slice(0, Number(f.arg)).join('');
      else if (f.name === 'upper') value = value.toUpperCase();
      else if (f.name === 'lower') value = value.toLowerCase();
      else if (f.name === 'trim') value = value.trim();
      else if (f.name === 'money' && value && Number.isFinite(Number(value)))
        value = money.format(Number(value) / 100);
    }
    out += value;
  }
  if (opts.maxLength !== undefined && [...out].length > opts.maxLength) {
    if (opts.overflow === 'fail')
      throw new TemplateError(`longer than ${opts.maxLength} characters`, 'TOO_LONG');
    out = [...out].slice(0, opts.maxLength).join('');
  }
  return out;
}

/** Shortcodes from earlier integrations' settings (Dinero.md) as template variables. */
export function convertShortcodes(src: string): string {
  return src
    .replaceAll('{', '{{')
    .replaceAll('}', '}}')
    .replaceAll('[order_number]', '{order.number}')
    .replaceAll('[refund_number]', '{creditNote.number}');
}
