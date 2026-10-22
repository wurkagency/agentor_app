import { html, plain, raw, rich, type Html } from './html.js';
import { C, MONO } from './theme.js';

/**
 * The building blocks of every Agentor e-mail (README decision 26, boards E01–E22). Each block is
 * one table row at 600 px with inline styles, plus its line(s) in the text version, so the text
 * version always follows the HTML order. The markup follows the boards and is kept on one line
 * per element: whitespace between inline elements shows in mail clients.
 */
export interface Block {
  html: Html;
  /** null: the block has no text-version counterpart (a divider). */
  text: string | null;
}

/** Hosted PNG icons (no SVG in mail): `${appUrl}/email/<name>.png`, 2x. */
export interface Assets {
  icon(name: IconName): string;
}
export type IconName = 'clock' | 'shield-info' | 'shield-warning' | 'shield-error' | 'file';

const row = (pad: string, inner: Html, extra = '', cls = '') =>
  html`<tr><td${cls ? raw(` class="${cls}"`) : ''} style="padding: ${raw(pad)};${raw(extra ? ` ${extra}` : '')}">${inner}</td></tr>`;

/* ---- Text ------------------------------------------------------------------------------------ */

export function heading(text: string): Block {
  return {
    html: row(
      '64px 40px 0',
      html`<h1 class="em-fg" style="margin: 0; font-size: 30px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; color: ${C.fg}">${text}</h1>`,
    ),
    text,
  };
}

/** Greeting and body copy, as on the boards: "Hej Mette" then the paragraph(s). */
export function paragraphs(...paras: (string | null | undefined | false)[]): Block {
  const list = paras.filter((p): p is string => Boolean(p));
  return {
    html: row(
      '16px 40px 0',
      raw(
        list
          .map(
            (p, i) =>
              html`<p style="margin: ${i === list.length - 1 ? '0' : '0 0 12px'}">${rich(p)}</p>`
                .value,
          )
          .join(''),
      ),
      `font-size: 16px; line-height: 1.6; color: ${C.fg}`,
      'em-fg',
    ),
    text: list.map(plain).join('\n\n'),
  };
}

export function button(label: string, href: string, pad = '28px 40px 0'): Block {
  return {
    html: row(
      pad,
      html`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.lime}" style="border-radius: 9999px; background: ${C.lime}"><a href="${href}" target="_blank" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 700; color: ${C.fg}; text-decoration: none; border-radius: 9999px">${label}</a></td></tr></table>`,
    ),
    text: `${label}: ${href}`,
  };
}

/** "Virker knappen ikke …" with the link written out in mono; breaks anywhere. */
export function fallbackLink(intro: string, href: string): Block {
  return {
    html: row(
      '28px 40px 0',
      html`${intro}<br><a href="${href}" target="_blank" class="em-fg" style="font-family: ${raw(MONO)}; font-size: 12.5px; color: ${C.fg}; word-break: break-all">${href}</a>`,
      `font-size: 13px; line-height: 1.5; color: ${C.muted}`,
      'em-muted',
    ),
    // The button line already carries the link in the text version.
    text: null,
  };
}

/** "Linket virker i **24 timer**" in a light chip with a clock. */
export function expiry(text: string, assets: Assets): Block {
  return {
    html: row(
      '16px 40px 0',
      html`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-soft em-fg" style="padding: 8px 12px; border-radius: 10px; background: ${C.soft}; font-size: 13px; line-height: 1.4; color: ${C.fg}"><img src="${assets.icon('clock')}" width="14" height="14" alt="" style="display: inline-block; vertical-align: -2px; margin-right: 6px; border: 0">${rich(text)}</td></tr></table>`,
    ),
    text: plain(text),
  };
}

export function divider(pad = '28px 40px 0'): Block {
  return {
    html: row(
      pad,
      html`<div class="em-rule" style="height: 1px; background: ${C.rule}; line-height: 1px; font-size: 1px">&nbsp;</div>`,
    ),
    text: null,
  };
}

/** Grey 13 px note: the safety note after the divider, or a hint under a button. */
export function smallPrint(text: string, pad = '20px 40px 0'): Block {
  return {
    html: row(
      pad,
      rich(text, `color: ${C.muted}`),
      `font-size: 13px; line-height: 1.5; color: ${C.muted}`,
      'em-muted',
    ),
    text: plain(text),
  };
}

export function signOff(greeting: string, name: string): Block {
  return {
    html: row(
      '24px 40px 36px',
      html`${greeting}<br><strong>${name}</strong>`,
      `font-size: 15px; line-height: 1.5; color: ${C.fg}`,
      'em-fg',
    ),
    text: `${greeting}\n${name}`,
  };
}

/* ---- Tables and panels ------------------------------------------------------------------------ */

export interface KeyValue {
  label: string;
  value: string;
}

/** Label/value rows with hairlines; an optional bold total row (receipts, E08). */
export function keyValueTable(rows: KeyValue[], total?: KeyValue): Block {
  const cell = `padding: 10px 0; border-bottom: 1px solid ${C.rule}; font-size: 14px`;
  const body = rows.map(
    (r) =>
      html`<tr><td class="em-line em-muted" style="${raw(cell)}; color: ${C.muted}">${r.label}</td><td class="em-line em-fg" style="${raw(cell)}; color: ${C.fg}; text-align: right; font-variant-numeric: tabular-nums">${r.value}</td></tr>`,
  );
  const tot = total
    ? html`<tr><td class="em-fg" style="padding: 14px 0 0; font-size: 16px; font-weight: 700; color: ${C.fg}">${total.label}</td><td class="em-fg" style="padding: 14px 0 0; font-size: 16px; font-weight: 700; color: ${C.fg}; text-align: right; font-variant-numeric: tabular-nums">${total.value}</td></tr>`
    : '';
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse">${body}${tot}</table>`,
    ),
    text: [...rows, ...(total ? [total] : [])].map((r) => `${r.label}: ${r.value}`).join('\n'),
  };
}

export type NoticeKind = 'info' | 'warning' | 'error';

/** Tinted box with a shield: "Var det dig?" (info), "Var det ikke dig?" (warning), errors. */
export function notice(
  kind: NoticeKind,
  title: string,
  body: string,
  assets: Assets,
  pad = '24px 40px 0',
): Block {
  return {
    html: row(
      pad,
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-${kind}" bgcolor="${C[kind].bg}" style="padding: 16px 18px; border-radius: 14px; background: ${C[kind].bg}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align: top; padding-right: 12px"><img src="${assets.icon(`shield-${kind}`)}" width="18" height="18" alt="" style="display: block; border: 0"></td><td class="em-fg" style="font-size: 14px; line-height: 1.5; color: ${C.fg}"><strong style="display: block; margin-bottom: 2px">${title}</strong>${rich(body)}</td></tr></table></td></tr></table>`,
    ),
    text: `${title}\n${plain(body)}`,
  };
}

/** Light grey panel with a title: satisfaction question (E12), "Sådan løser du det" (E20). */
export function panel(
  title: string,
  body: string,
  opts: { titleSize?: 14 | 15; tone?: 'muted' | 'fg' } = {},
): Block {
  const muted = (opts.tone ?? 'muted') === 'muted';
  const bodyHtml = muted
    ? html`<span class="em-muted" style="font-size: 14px; color: ${C.muted}">${rich(body, `color: ${C.fg}`, ` class="em-fg" style="color: ${C.fg}"`)}</span>`
    : html`<span style="font-size: 14px; line-height: 1.6">${rich(body)}</span>`;
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-soft em-fg" bgcolor="${C.soft}" style="padding: 18px 20px; border-radius: 14px; background: ${C.soft}; color: ${C.fg}"><strong style="font-size: ${opts.titleSize ?? 15}px">${title}</strong><br>${bodyHtml}</td></tr></table>`,
    ),
    text: `${title}\n${plain(body)}`,
  };
}

/** Amount and due date side by side (E15). */
export function amountPanel(a: {
  amountLabel: string;
  amount: string;
  dueLabel: string;
  due: string;
}): Block {
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-soft" bgcolor="${C.soft}" style="padding: 18px 20px; border-radius: 14px; background: ${C.soft}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-muted" style="font-size: 13px; color: ${C.muted}">${a.amountLabel}</td><td class="em-muted" style="font-size: 13px; color: ${C.muted}; text-align: right">${a.dueLabel}</td></tr><tr><td class="em-fg" style="font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: ${C.fg}">${a.amount}</td><td class="em-bad" style="font-size: 16px; font-weight: 700; color: ${C.bad}; text-align: right">${a.due}</td></tr></table></td></tr></table>`,
    ),
    text: `${a.amountLabel}: ${a.amount}\n${a.dueLabel}: ${a.due}`,
  };
}

/** Six code cells in mono 30 px (E04, E06). The code is also first in the subject. */
export function codeBoxes(code: string, ariaLabel: string): Block {
  const cells = [...code].map(
    (d) =>
      html`<td class="em-soft em-fg" style="width: 52px; height: 64px; border-radius: 12px; background: ${C.soft}; border: 1px solid ${C.rule}; text-align: center; vertical-align: middle; font-family: ${raw(MONO)}; font-size: 30px; font-weight: 500; color: ${C.fg}">${d}</td><td style="width: 8px"></td>`,
  );
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-label="${ariaLabel}"><tr>${cells}</tr></table>`,
    ),
    text: code,
  };
}

export interface TimelineItem {
  who: string;
  when: string;
  body: string;
  dot: 'customer' | 'agentor' | 'staff' | 'status';
}

const DOT: Record<TimelineItem['dot'], string> = {
  customer: C.fg,
  agentor: C.lime,
  staff: C.fg,
  status: C.ok,
};

function sectionLabel(title: string, gap: number): Html {
  return html`<div class="em-muted" style="font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${C.muted}; margin-bottom: ${gap}px">${title}</div>`;
}

/** The case history in E12. Internal notes are never passed in. */
export function timeline(title: string, items: TimelineItem[]): Block {
  const rows = items.map(
    (i) =>
      html`<tr><td style="width: 22px; vertical-align: top; padding-top: 4px"><div style="width: 10px; height: 10px; border-radius: 9999px; background: ${DOT[i.dot]}; box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 4px ${C.rule}"></div></td><td class="em-fg" style="padding: 0 0 18px; font-size: 14px; line-height: 1.5; color: ${C.fg}"><strong>${i.who}</strong> <span class="em-muted" style="color: ${C.muted}">· ${i.when}</span><br>${rich(i.body)}</td></tr>`,
  );
  return {
    html: row(
      '28px 40px 0',
      html`${sectionLabel(title, 14)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
    ),
    text: [title.toUpperCase(), ...items.map((i) => `${i.who} · ${i.when}\n${plain(i.body)}`)].join(
      '\n\n',
    ),
  };
}

/** Three or four number tiles (E18, E22). */
export function statGrid(stats: { value: string; label: string }[]): Block {
  // Tiles share what the 10 px gaps leave (content width: minus each tile's 32 px padding);
  // percentages alone would squeeze the gaps away.
  const width = `${Math.floor((520 - (stats.length - 1) * 10) / stats.length) - 32}px`;
  const cells = stats.map(
    (s, i) =>
      html`${i ? html`<td width="10" style="width: 10px; min-width: 10px; font-size: 1px">&nbsp;</td>` : ''}<td class="em-soft" bgcolor="${C.soft}" style="width: ${width}; padding: 14px 16px; border-radius: 14px; background: ${C.soft}; vertical-align: top"><div class="em-fg" style="font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: ${C.fg}; font-variant-numeric: tabular-nums">${s.value}</div><div class="em-muted" style="font-size: 12px; color: ${C.muted}; margin-top: 2px">${s.label}</div></td>`,
  );
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
    ),
    text: stats.map((s) => `${s.label}: ${s.value}`).join('\n'),
  };
}

/** Usage bar (E21). `ratio` 0–1; the bar never overflows. */
export function progressBar(label: string, value: string, ratio: number): Block {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-muted" style="font-size: 13px; color: ${C.muted}">${label}</td><td class="em-fg" style="font-size: 13px; color: ${C.fg}; font-weight: 700; text-align: right">${value}</td></tr><tr><td colspan="2" style="padding-top: 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-rule" bgcolor="${C.rule}" style="height: 10px; border-radius: 9999px; background: ${C.rule}; font-size: 1px; line-height: 1px"><div style="height: 10px; width: ${pct}%; border-radius: 9999px; background: ${C.lime}; box-shadow: inset 0 0 0 1px rgba(26,26,24,.25)">&nbsp;</div></td></tr></table></td></tr></table>`,
    ),
    text: `${label}: ${value}`,
  };
}

/** The attached file (E18). */
export function attachmentChip(name: string, meta: string, assets: Assets): Block {
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 12px 16px; border-radius: 12px; border: 1px solid ${C.rule}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right: 12px"><img src="${assets.icon('file')}" width="20" height="20" alt="" style="display: block; border: 0"></td><td class="em-fg" style="font-size: 14px; line-height: 1.35; color: ${C.fg}"><strong style="font-family: ${raw(MONO)}; font-size: 13px">${name}</strong><br><span class="em-muted" style="color: ${C.muted}; font-size: 12px">${meta}</span></td></tr></table></td></tr></table>`,
    ),
    text: `${name} (${meta})`,
  };
}

export interface LedgerLine {
  number: string;
  detail: string;
  amount: string;
}

/** Open items with a total (E17), or the empty text. */
export function ledger(lines: LedgerLine[], total: KeyValue, empty: string): Block {
  if (lines.length === 0)
    return {
      html: row(
        '24px 40px 0',
        html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-soft em-fg" bgcolor="${C.soft}" style="padding: 18px 20px; border-radius: 14px; background: ${C.soft}; font-size: 15px; font-weight: 600; color: ${C.fg}">${empty}</td></tr></table>`,
      ),
      text: empty,
    };
  const cell = `padding: 10px 0; border-bottom: 1px solid ${C.rule}; font-size: 14px`;
  const body = lines.map(
    (l) =>
      html`<tr><td class="em-line em-fg" style="${raw(cell)}; color: ${C.fg}"><span style="font-family: ${raw(MONO)}; font-size: 13px">${l.number}</span><br><span class="em-muted" style="color: ${C.muted}; font-size: 13px">${l.detail}</span></td><td class="em-line em-fg" style="${raw(cell)}; color: ${C.fg}; text-align: right; font-variant-numeric: tabular-nums; vertical-align: top">${l.amount}</td></tr>`,
  );
  return {
    html: row(
      '24px 40px 0',
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse">${body}<tr><td class="em-fg" style="padding: 14px 0 0; font-size: 16px; font-weight: 700; color: ${C.fg}">${total.label}</td><td class="em-fg" style="padding: 14px 0 0; font-size: 16px; font-weight: 700; color: ${C.fg}; text-align: right; font-variant-numeric: tabular-nums">${total.value}</td></tr></table>`,
    ),
    text: [
      ...lines.map((l) => `${l.number}  ${l.detail}  ${l.amount}`),
      `${total.label}: ${total.value}`,
    ].join('\n'),
  };
}

export interface StatusLine {
  name: string;
  count: string;
  status: string;
  tone: 'ok' | 'bad';
}

/** Flows with a count and a status word (E22). */
export function statusTable(title: string, lines: StatusLine[]): Block {
  const cell = `padding: 10px 0; border-bottom: 1px solid ${C.rule}; font-size: 14px`;
  const body = lines.map(
    (l) =>
      html`<tr><td class="em-line em-fg" style="${raw(cell)}; color: ${C.fg}">${l.name}</td><td class="em-line em-fg" style="${raw(cell)}; color: ${C.fg}; text-align: right; font-variant-numeric: tabular-nums">${l.count}</td><td class="em-line em-${l.tone}" style="padding: 10px 0 10px 16px; border-bottom: 1px solid ${C.rule}; font-size: 13px; text-align: right; color: ${l.tone === 'ok' ? C.ok : C.bad}; font-weight: 600; white-space: nowrap">${l.status}</td></tr>`,
  );
  return {
    html: row(
      '28px 40px 0',
      html`${sectionLabel(title, 6)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse">${body}</table>`,
    ),
    text: [title.toUpperCase(), ...lines.map((l) => `${l.name}  ${l.count}  ${l.status}`)].join(
      '\n',
    ),
  };
}
