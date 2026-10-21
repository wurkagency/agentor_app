import { formatMessage } from '@agentor/core';
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatNumber,
  formatTime,
  type Locale,
} from '@agentor/i18n';
import da from '@agentor/i18n/messages/da.json' with { type: 'json' };
import en from '@agentor/i18n/messages/en.json' with { type: 'json' };
import type { Assets, IconName } from './blocks.js';

/**
 * What every template gets besides its props: the app's absolute URL (links and hosted images),
 * the language, a translator for the `email.*` catalog and the shared formatters.
 */
export interface RenderContext {
  appUrl: string;
  locale: Locale;
  /** "Now" for relative wording ("i dag kl. 07:58"); fixed in tests and previews. */
  now: Date;
}

type Tree = { [k: string]: string | Tree };
const CATALOG: Record<Locale, Tree> = {
  da: (da as unknown as { email: Tree }).email,
  en: (en as unknown as { email: Tree }).email,
};

export class MissingCopyError extends Error {
  constructor(key: string, locale: string) {
    super(`Missing e-mail copy ${locale}:email.${key}`);
    this.name = 'MissingCopyError';
  }
}

export type Params = Record<string, string | number>;

export interface Tools {
  ctx: RenderContext;
  /** email.<key> in the context's language, ICU-lite ({x}, plural). Throws when missing. */
  t(key: string, params?: Params): string;
  assets: Assets;
  /** An absolute app URL from a path ("/billing" → "https://app.agentor.dk/billing"). */
  url(path: string): string;
  /** Øre → "1.987,50 kr."; `whole` drops ",00" on whole kroner ("159 kr."). */
  money(ore: number, whole?: boolean): string;
  number(n: number): string;
  date(d: Date): string;
  /** "9. okt." (no year), for preheaders. */
  dayMonth(d: Date): string;
  dateTime(d: Date): string;
  /** "14:02" */
  time(d: Date): string;
  /** Copenhagen calendar day, "2026-10-21". */
  day(d: Date): string;
  /** "1 t 27 min." */
  minutes(m: number): string;
  /** "i dag kl. 07:58", "i går kl. 09:14", or the full date and time. */
  when(d: Date): string;
}

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

const dayKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(d);

export function tools(ctx: RenderContext): Tools {
  const base = ctx.appUrl.replace(/\/+$/, '');
  const t = (key: string, params: Params = {}) => {
    const s = lookup(CATALOG[ctx.locale], key) ?? lookup(CATALOG.da, key);
    if (s === undefined) throw new MissingCopyError(key, ctx.locale);
    return formatMessage(s, params);
  };
  const money = (ore: number, whole = false) => {
    const s = formatMoney(ore / 100, ctx.locale);
    return whole && ore % 100 === 0 ? s.replace(/[,.]00(?=\D*$)/, '') : s;
  };
  return {
    ctx,
    t,
    assets: { icon: (name: IconName) => `${base}/email/${name}.png` },
    url: (path) =>
      /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`,
    money,
    number: (n) => formatNumber(n, ctx.locale),
    date: (d) => formatDate(d, ctx.locale),
    dayMonth: (d) => formatDate(d, ctx.locale).replace(/\s*\d{4}$/, ''),
    dateTime: (d) => formatDateTime(d, ctx.locale),
    minutes: (m) => formatMinutes(m, ctx.locale),
    time: (d) => formatTime(d, ctx.locale),
    day: dayKey,
    when: (d) => {
      const today = dayKey(ctx.now);
      const yesterday = dayKey(new Date(ctx.now.getTime() - 86_400_000));
      const day = dayKey(d);
      if (day === today) return t('common.todayAt', { time: formatTime(d, ctx.locale) });
      if (day === yesterday) return t('common.yesterdayAt', { time: formatTime(d, ctx.locale) });
      return formatDateTime(d, ctx.locale);
    },
  };
}
