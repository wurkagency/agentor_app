import { randomBytes } from 'node:crypto';
import { manifestFor } from '@agentor/connectors';
import {
  copenhagenMidnight,
  explain,
  formatMessage,
  quietUntil,
  weekFromKey,
  type PushCategory,
} from '@agentor/core';
import {
  connectionEmailFacts,
  dueEmails,
  emailDefer,
  emailFailed,
  emailRecipient,
  emailSent,
  emailSkip,
  quotaFacts,
  unsubscribeToken,
  weeklyStats,
  type Database,
  type DueEmail,
  type EmailRecipient,
} from '@agentor/db';
import type { SendEmail, SystematicIncident } from '@agentor/email';
import da from '@agentor/i18n/messages/da.json' with { type: 'json' };
import en from '@agentor/i18n/messages/en.json' with { type: 'json' };
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * Notification e-mails (PLAN-EMAILS-PDF §5): drains app.email_queue every few seconds. E19
 * (connection lost) goes at once, also in quiet hours; E20 (systematic error) and E21 (quota) wait
 * for the end of quiet hours, and E20s that waited become one e-mail. E22 (weekly summary) is
 * queued by the scheduler on Monday at 08:00. Each row is sent once; the recipient's e-mail
 * choice is checked again at send time.
 */
export interface EmailDeps {
  db: Database;
  redis: Redis;
  log: Logger;
  send: SendEmail;
  appUrl: string;
}

type Catalog = typeof da;
const CATALOG: Record<'da' | 'en', Catalog> = { da, en: en as unknown as Catalog };

/** recordErrors.* in the recipient's language, for explain() (same texts as the app). */
function recordT(locale: 'da' | 'en') {
  const tree = CATALOG[locale].recordErrors as unknown as Record<string, unknown>;
  return (key: string, params: Record<string, string> = {}) => {
    let node: unknown = tree;
    for (const k of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[k];
    return typeof node === 'string' ? formatMessage(node, params) : '';
  };
}

/** "3 ordrer" without the number: the plural noun for E20's subject. */
function entityPlural(locale: 'da' | 'en', entity: string, count: number): string {
  const nouns = (CATALOG[locale].email as unknown as { entity: Record<string, string> }).entity;
  return formatMessage(nouns[entity] ?? nouns.record!, { count });
}

const CATEGORY: Record<DueEmail['event'], PushCategory | null> = {
  connection_broken: null, // critical: never held
  systematic_error: 'errors',
  quota: 'quota',
  weekly_summary: 'weekly',
};

/** One drain pass; a Redis lock keeps two workers from sending the same e-mail. */
export async function drainEmailQueue(deps: EmailDeps, now = new Date()): Promise<number> {
  const locked = await deps.redis.set('agentor:email-drain', '1', 'PX', 55_000, 'NX');
  if (!locked) return 0;
  try {
    const due = await dueEmails(deps.db, now);
    let sent = 0;
    // E20s for the same person in this pass become one e-mail.
    const systematic = new Map<string, { rows: DueEmail[]; who: EmailRecipient }>();
    for (const row of due) {
      try {
        const who = await emailRecipient(deps.db, row);
        if (!who || !who.emailOn) {
          await emailSkip(deps.db, row.id);
          continue;
        }
        const category = CATEGORY[row.event];
        if (category) {
          const until = quietUntil(now, who.quiet, category);
          if (until > now) {
            await emailDefer(deps.db, row.id, until);
            continue;
          }
        }
        if (row.event === 'systematic_error') {
          const k = `${row.tenantId}:${row.userId}`;
          const group = systematic.get(k) ?? { rows: [], who };
          group.rows.push(row);
          systematic.set(k, group);
          continue;
        }
        if (await sendOne(deps, row, who, now)) sent++;
      } catch (err) {
        await failed(deps, row, err);
      }
    }
    for (const { rows, who } of systematic.values()) {
      try {
        if (await sendSystematic(deps, rows, who)) sent++;
      } catch (err) {
        for (const r of rows) await failed(deps, r, err);
      }
    }
    return sent;
  } finally {
    await deps.redis.del('agentor:email-drain');
  }
}

async function failed(deps: EmailDeps, row: DueEmail, err: unknown) {
  await emailFailed(deps.db, row.id);
  // Never the address or the body; the template and the row are enough to find it.
  deps.log.warn(
    {
      email: row.id,
      event: row.event,
      tenantId: row.tenantId,
      attempt: row.attempts + 1,
      err: err instanceof Error ? err.message : String(err),
    },
    'notification e-mail failed',
  );
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? null;

async function sendOne(
  deps: EmailDeps,
  row: DueEmail,
  who: EmailRecipient,
  now: Date,
): Promise<boolean> {
  const url = (path: string) => new URL(path, deps.appUrl).toString();
  const settingsUrl = url('/settings/notifications');
  const opts = { to: who.email, locale: who.locale, entityRef: `${row.event}-${row.dedupeKey}` };
  if (row.event === 'connection_broken') {
    const n = who.notification;
    // Fixed before the e-mail went out: nothing to tell.
    if (!n?.connectionId || n.resolvedAt) return skip(deps, row);
    const facts = await connectionEmailFacts(deps.db, row.tenantId, row.userId, n.connectionId);
    if (!facts || facts.status !== 'broken') return skip(deps, row);
    const expired =
      (facts.tokenExpiresAt !== null && facts.tokenExpiresAt <= now) ||
      /adgang|log ind/i.test(facts.statusReason ?? '');
    const res = await deps.send(
      'notify-connection-broken',
      {
        firstName: first(who.name),
        system: manifestFor(facts.connectorId)?.name ?? facts.connectorId,
        account: facts.name,
        cause: expired ? 'expired' : 'other',
        since: facts.brokenSince ?? n.createdAt,
        flows: facts.flows.map((f) => ({ name: f.name, routes: f.routes })),
        queued: facts.waiting,
        url: url(`/connections/${n.connectionId}/reconnect`),
        company: who.tenantName,
        settingsUrl,
      },
      opts,
    );
    await emailSent(deps.db, row.id, res.messageId);
    return true;
  }
  if (row.event === 'quota') {
    const period = row.dedupeKey.replace(/^quota:/, '');
    const facts = await quotaFacts(deps.db, row.tenantId, period);
    if (!facts.limit) return skip(deps, row);
    const [y, m] = period.split('-').map(Number);
    const res = await deps.send(
      'notify-quota-80',
      {
        firstName: first(who.name),
        company: who.tenantName,
        used: facts.used,
        limit: facts.limit,
        // The counter resets on the 1st of next month (Copenhagen).
        resetsAt: copenhagenMidnight(new Date(Date.UTC(y!, m!, 1))),
        periodDay: new Date(Date.UTC(y!, m! - 1, 15, 12)),
        plan: facts.plan,
        url: url('/billing'),
        settingsUrl,
      },
      opts,
    );
    await emailSent(deps.db, row.id, res.messageId);
    return true;
  }
  if (row.event === 'weekly_summary') {
    const week = weekFromKey(row.dedupeKey);
    if (!week) return skip(deps, row);
    const stats = await weeklyStats(deps.db, row.tenantId, row.userId, week.from, week.to);
    const token = await unsubscribeToken(
      deps.db,
      row.tenantId,
      row.userId,
      randomBytes(24).toString('base64url'),
    );
    const unsubscribeUrl = url(`/unsubscribe/${token}`);
    const res = await deps.send(
      'weekly-summary',
      {
        firstName: first(who.name),
        company: who.tenantName,
        week: week.number,
        from: week.from,
        to: new Date(week.to.getTime() - 1),
        records: stats.records,
        orders: stats.orders,
        errors: stats.errors,
        okRatio: stats.runs ? stats.okRuns / stats.runs : 1,
        flows: stats.flows,
        url: url('/'),
        unsubscribeUrl,
      },
      // The footer link opens the page; the header is the one-click POST (RFC 8058).
      { ...opts, unsubscribeUrl: url(`/api/unsubscribe/${token}`) },
    );
    await emailSent(deps.db, row.id, res.messageId);
    return true;
  }
  return skip(deps, row);
}

async function skip(deps: EmailDeps, row: DueEmail): Promise<false> {
  await emailSkip(deps.db, row.id);
  return false;
}

/** One E20 e-mail with every incident that waited for this person. */
async function sendSystematic(
  deps: EmailDeps,
  rows: DueEmail[],
  who: EmailRecipient,
): Promise<boolean> {
  const incidents: SystematicIncident[] = [];
  const used: DueEmail[] = [];
  for (const row of rows) {
    // The row's own recipient view carries its notification; re-read per row.
    const r = row === rows[0] ? who : await emailRecipient(deps.db, row);
    const n = r?.notification;
    if (!n || n.resolvedAt) {
      await emailSkip(deps.db, row.id);
      continue;
    }
    incidents.push(incidentOf(n, who.locale, deps.appUrl));
    used.push(row);
  }
  if (!incidents.length) return false;
  const res = await deps.send(
    'notify-systematic-error',
    {
      firstName: first(who.name),
      incidents,
      company: who.tenantName,
      overviewUrl: new URL('/', deps.appUrl).toString(),
      settingsUrl: new URL('/settings/notifications', deps.appUrl).toString(),
    },
    { to: who.email, locale: who.locale, entityRef: `systematic_error-${used[0]!.dedupeKey}` },
  );
  // The first row carries the message id; the others were merged into it.
  await emailSent(deps.db, used[0]!.id, res.messageId);
  for (const r of used.slice(1)) await emailSkip(deps.db, r.id);
  return true;
}

function incidentOf(
  n: NonNullable<EmailRecipient['notification']>,
  locale: 'da' | 'en',
  appUrl: string,
): SystematicIncident {
  const p = n.params;
  const s = (k: string) => (p[k] === undefined ? '' : String(p[k]));
  const errorParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(p))
    if (k.startsWith('p_')) errorParams[k.slice(2)] = String(v);
  const t = recordT(locale);
  const e = explain(t, {
    errorCode: s('code') || null,
    errorParams,
    label: s('label'),
    entity: s('entity'),
    system: s('system'),
  });
  const count = Number(p.count ?? 0);
  return {
    count,
    entity: entityPlural(locale, s('entity'), count),
    flow: s('flow'),
    at: p.at ? new Date(String(p.at)) : n.createdAt,
    why: e.why,
    fix: e.steps.join(' '),
    url: new URL(n.href ?? '/', appUrl).toString(),
    summary: e.short ? `${e.short}.`.replace(/\.\.$/, '.') : null,
  };
}
