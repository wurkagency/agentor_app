/**
 * Web Push content (PLAN-MOBILE M3, MA14): which device toggle a notification belongs to, where
 * the push opens the app, and when quiet hours hold it back. Shared by the worker (sending) and
 * the web app (settings). Pure functions, no I/O.
 */

export type PushCategory = 'errors' | 'connection' | 'support' | 'quota' | 'weekly';

/** The MA11 toggle a notification's message belongs to; null = never pushed. */
export function pushCategory(messageKey: string): PushCategory | null {
  switch (messageKey) {
    case 'recordsFailed':
    case 'creditNotesFailed':
    case 'paymentFailed':
      return 'errors';
    case 'connectionBroken':
      return 'connection';
    case 'supportRequested':
    case 'supportExtension':
      return 'support';
    case 'quota':
      return 'quota';
    case 'weekly':
      return 'weekly';
    default:
      return null;
  }
}

/**
 * The mobile screen a notification opens (MA14 "åbner det rigtige sted"): run failures go to the
 * failure screen (MA06), broken connections to reconnect (MA08), support requests to MA12.
 * Only same-origin paths come out.
 */
export function pushUrl(href: string | null, opts: { grantId?: string | null } = {}): string {
  if (opts.grantId) return `/support-access/${opts.grantId}`;
  if (!href || !href.startsWith('/') || href.startsWith('//')) return '/notifications';
  const run = /^\/integrations\/([0-9a-f-]{36})\?(?:.*&)?run=([0-9a-f-]{36})/.exec(href);
  if (run) return `/integrations/${run[1]}/runs/${run[2]}`;
  const conn = /^\/connections\/([0-9a-f-]{36})(?:\?.*)?$/.exec(href);
  if (conn) return `/connections/${conn[1]}/reconnect`;
  if (href.startsWith('/settings/security')) return '/notifications';
  return href;
}

/** Minutes since midnight for "HH:MM". */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Wall-clock hour and minute in Copenhagen. */
function localMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * When a push may go out given the user's quiet hours (default 22:00–07:00, MA11): `now` if it
 * may go now, otherwise the end of the quiet period. Support requests are never held (B7).
 */
export function quietUntil(
  now: Date,
  quiet: { enabled: boolean; start: string; end: string },
  category: PushCategory,
  timeZone = 'Europe/Copenhagen',
): Date {
  if (!quiet.enabled || category === 'support') return now;
  const s = minutes(quiet.start);
  const e = minutes(quiet.end);
  if (s === e) return now;
  const cur = localMinutes(now, timeZone);
  const inside = s < e ? cur >= s && cur < e : cur >= s || cur < e;
  if (!inside) return now;
  const wait = (e - cur + 24 * 60) % (24 * 60);
  return new Date(
    now.getTime() + wait * 60_000 - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()),
  );
}

/** The tiny part of ICU the push texts use: {name} and {n, plural, one {…#…} other {…#…}}. */
export function formatMessage(template: string, params: Record<string, string | number>): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    // Find the matching close brace.
    let depth = 0;
    let j = open;
    for (; j < template.length; j++) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}' && --depth === 0) break;
    }
    const inner = template.slice(open + 1, j);
    const plural = /^(\w+),\s*plural,\s*([\s\S]*)$/.exec(inner);
    if (plural) {
      const n = Number(params[plural[1]!] ?? 0);
      const forms = Object.fromEntries(
        [...plural[2]!.matchAll(/(=\d+|\w+)\s*\{([^{}]*)\}/g)].map((m) => [m[1], m[2]]),
      );
      const form = forms[`=${n}`] ?? (n === 1 ? forms.one : undefined) ?? forms.other ?? '';
      out += form.replaceAll('#', String(n));
    } else out += String(params[inner.trim()] ?? '');
    i = j + 1;
  }
  return out;
}
