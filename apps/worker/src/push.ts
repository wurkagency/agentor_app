import { formatMessage, pushCategory, pushUrl, quietUntil } from '@agentor/core';
import {
  dropPushSubscription,
  duePushes,
  latestPendingGrant,
  pushContext,
  pushDefer,
  pushDone,
  type Database,
  type DuePush,
} from '@agentor/db';
import da from '@agentor/i18n/messages/da.json' with { type: 'json' };
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import webpush from 'web-push';

/**
 * Web Push (PLAN-MOBILE M3, MA14): drains app.push_queue every few seconds. A push says what
 * happened and opens the right screen; it carries no customer personal data (flow and system
 * names, counts, the Agentor staff member's first name). Quiet hours hold errors until the
 * morning and send them as one push; support requests are never held (B7).
 */
export interface PushDeps {
  db: Database;
  redis: Redis;
  log: Logger;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
}

const COPY = da.mobile.push as Record<string, { title: string; body: string }>;

function text(key: string, params: Record<string, string | number>) {
  const c = COPY[key] ?? COPY.generic!;
  return { title: formatMessage(c.title, params), body: formatMessage(c.body, params) };
}

/** One drain pass; a Redis lock keeps two workers from sending the same push. */
export async function drainPushQueue(deps: PushDeps, now = new Date()): Promise<number> {
  if (!deps.vapid) return 0;
  const locked = await deps.redis.set('agentor:push-drain', '1', 'PX', 14_000, 'NX');
  if (!locked) return 0;
  try {
    const due = await duePushes(deps.db, now);
    // Several pushes for one user that waited out quiet hours become one (MA11).
    const morning = new Map<string, DuePush[]>();
    let sent = 0;
    for (const p of due) {
      const ctx = await pushContext(deps.db, p);
      if (!ctx) {
        await pushDone(deps.db, p.id);
        continue;
      }
      const n = ctx.notification;
      const category = pushCategory(n.messageKey);
      if (!category) {
        await pushDone(deps.db, p.id);
        continue;
      }
      const devices = ctx.devices.filter((d) => d.events[category]);
      if (devices.length === 0) {
        await pushDone(deps.db, p.id);
        continue;
      }
      const until = quietUntil(now, ctx.quiet, category);
      if (until > now) {
        await pushDefer(deps.db, p.id, until);
        continue;
      }
      if (category !== 'support' && n.createdAt.getTime() < now.getTime() - 30 * 60_000) {
        const k = `${p.tenantId}:${p.userId}`;
        morning.set(k, [...(morning.get(k) ?? []), p]);
        continue;
      }
      const params = n.params as Record<string, string | number>;
      const first = String(params.name ?? '').split(' ')[0] ?? '';
      const grantId =
        category === 'support' ? await latestPendingGrant(deps.db, p.tenantId, n.createdAt) : null;
      const message =
        p.kind === 'resolved'
          ? text('resolved', {
              subject: String(params.flow ?? params.connector ?? params.name ?? ''),
            })
          : text(n.messageKey, { ...params, first });
      const payload = {
        ...message,
        url: pushUrl(n.href, { grantId }),
        tag: `${n.id}:${p.kind}`,
      };
      sent += await deliver(deps, p.tenantId, devices, payload);
      await pushDone(deps.db, p.id);
    }
    for (const list of morning.values()) {
      const first = list[0]!;
      const ctx = await pushContext(deps.db, first);
      const devices = ctx?.devices.filter((d) => d.events.errors) ?? [];
      if (devices.length)
        sent += await deliver(deps, first.tenantId, devices, {
          ...text('morning', { count: list.length }),
          url: list.length === 1 && ctx ? pushUrl(ctx.notification.href) : '/notifications',
          tag: `morning:${first.userId}`,
        });
      for (const p of list) await pushDone(deps.db, p.id);
    }
    return sent;
  } finally {
    await deps.redis.del('agentor:push-drain');
  }
}

async function deliver(
  deps: PushDeps,
  tenantId: string,
  devices: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<number> {
  let ok = 0;
  for (const d of devices) {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        JSON.stringify(payload),
        {
          TTL: 24 * 3600,
          urgency: 'high',
          topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
          vapidDetails: deps.vapid!,
        },
      );
      ok++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await dropPushSubscription(deps.db, tenantId, d.id);
      // The endpoint identifies a browser; it is never logged.
      deps.log.warn({ tenantId, device: d.id, status }, 'push failed');
    }
  }
  return ok;
}
