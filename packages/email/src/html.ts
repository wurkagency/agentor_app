/**
 * Safe HTML strings for e-mail. Every interpolated value is escaped unless it is already `Html`
 * (another block, or `raw()` for markup written in this package). Nothing a customer typed can
 * become markup.
 */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

type Value = Html | string | number | null | undefined | false | readonly Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(String(v));
}

/** html`<td>${text}</td>`: escapes values, keeps nested Html. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Html(out);
}

/** Markup written in this package (never customer data). */
export const raw = (s: string) => new Html(s);

/**
 * Copy from the message catalogs with two small conventions: **bold** becomes <strong>, and
 * support@agentor.dk becomes a mailto link. Everything else is escaped.
 */
export function rich(
  text: string,
  linkStyle = 'color: #1A1A18; font-weight: 600',
  strongAttrs = '',
): Html {
  const escaped = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, `<strong${strongAttrs}>$1</strong>`)
    .replace(
      /support@agentor\.dk/g,
      `<a href="mailto:support@agentor.dk" style="${linkStyle}">support@agentor.dk</a>`,
    )
    .replace(/\n/g, '<br>');
  return new Html(escaped);
}

/** The text version of copy written for rich(): markers removed. */
export const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');
