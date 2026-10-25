import {
  countRecords,
  manifestFor,
  verifyWebhookSignature,
  type ConnectorAdapter,
  type LookupId,
} from '@agentor/connectors';
import { openAdapter } from '@agentor/connectors/live';
import {
  createEngineRun,
  flowsReading,
  loadConnectionForWorker,
  markDelivery,
  notify,
  resolveNotifications,
  saveLookup,
  loadInboundEvent,
  markInboundEvent,
  recordConnectionTest,
  storeDekSecret,
  tenantDek,
  type Database,
} from '@agentor/db';
import { parseDefinition } from '@agentor/flows';
import { enqueueFlowRun, parseConnectionJob, type ConnectionJobName } from '@agentor/jobs';
import type { Queue } from 'bullmq';
import {
  DEK_FORMAT,
  dekDecrypt,
  dekEncrypt,
  newWrappedDek,
  open,
  SEALED_FORMAT,
  secretBinding,
  unwrapDek,
} from '@agentor/keybox';
import type { KeyObject } from 'node:crypto';
import type { Logger } from 'pino';

export interface ConnectionDeps {
  db: Database;
  kekPrivate: KeyObject;
  kekPublic: KeyObject;
  /** Identifies the KEK a DEK was sealed to, for rotation. */
  kekId: string;
  connectorMode: 'mock' | 'live';
  /** OAuth clients for token refresh, per connector (Dinero: Visma Connect). */
  oauth?: Partial<Record<string, { clientId: string; clientSecret: string }>>;
  log: Logger;
  /** Webhooks start runs on the flows queue. */
  flowQueue?: Queue;
}

/**
 * The connection's credentials in plaintext, for this job only. A secret the web sealed to the
 * KEK is moved under the tenant DEK on first use, so the KEK private key is needed only to
 * unwrap DEKs from then on.
 */
export async function credentials(
  deps: ConnectionDeps,
  tenantId: string,
  connectionId: string,
): Promise<Record<string, string> | null> {
  const conn = await loadConnectionForWorker(deps.db, tenantId, connectionId);
  if (!conn?.secret) return null;
  const bind = secretBinding(tenantId, connectionId);
  const dekRow = await tenantDek(deps.db, tenantId, () => ({
    wrapped: newWrappedDek(deps.kekPublic, tenantId).wrapped,
    kekId: deps.kekId,
  }));
  const dek = unwrapDek(dekRow.wrapped, deps.kekPrivate, tenantId);
  let plain: Buffer;
  if (conn.secret.format === SEALED_FORMAT) {
    plain = open(conn.secret, deps.kekPrivate, bind);
    await storeDekSecret(deps.db, tenantId, connectionId, dekRow.id, dekEncrypt(plain, dek, bind));
  } else if (conn.secret.format === DEK_FORMAT) {
    plain = dekDecrypt(conn.secret, dek, bind);
  } else {
    throw new Error(`unknown secret format ${conn.secret.format}`);
  }
  return JSON.parse(plain.toString('utf8')) as Record<string, string>;
}

/**
 * Merges changed credentials (a rotated refresh token, a webhook secret) into the key box. The
 * newest secret is read first, so two changes in a row both survive.
 */
export async function persistCredentials(
  deps: ConnectionDeps,
  tenantId: string,
  connectionId: string,
  patch: Record<string, string>,
): Promise<void> {
  const current = (await credentials(deps, tenantId, connectionId)) ?? {};
  const next = { ...current, ...patch };
  const dekRow = await tenantDek(deps.db, tenantId, () => ({
    wrapped: newWrappedDek(deps.kekPublic, tenantId).wrapped,
    kekId: deps.kekId,
  }));
  const dek = unwrapDek(dekRow.wrapped, deps.kekPrivate, tenantId);
  const bind = secretBinding(tenantId, connectionId);
  await storeDekSecret(
    deps.db,
    tenantId,
    connectionId,
    dekRow.id,
    dekEncrypt(Buffer.from(JSON.stringify(next), 'utf8'), dek, bind),
  );
}

/** The adapter for a connection: live client or mock, with its settings and a credential store. */
export function connectionAdapter(
  deps: ConnectionDeps,
  tenantId: string,
  conn: { id: string; connectorId: string; settings?: Record<string, unknown> },
  creds: Record<string, string>,
): ConnectorAdapter {
  return openAdapter({
    connectorId: conn.connectorId,
    credentials: creds,
    mode: deps.connectorMode,
    settings: conn.settings ?? {},
    connectionId: conn.id,
    persist: (patch) => persistCredentials(deps, tenantId, conn.id, patch),
    ...(deps.oauth ? { oauth: deps.oauth } : {}),
  });
}

const REASONS = {
  unauthorized: 'Adgangen blev afvist. Log ind igen for at give Agentor adgang.',
  unreachable: 'Systemet svarede ikke. Vi prøver igen automatisk.',
  unknown: 'Forbindelsen kunne ikke kontrolleres.',
} as const;

async function testConnection(deps: ConnectionDeps, tenantId: string, connectionId: string) {
  const conn = await loadConnectionForWorker(deps.db, tenantId, connectionId);
  if (!conn) return; // deleted meanwhile
  const creds = await credentials(deps, tenantId, connectionId);
  if (!creds) {
    await recordConnectionTest(deps.db, tenantId, connectionId, {
      ok: false,
      reason: REASONS.unauthorized,
    });
    return;
  }
  let tested: ConnectorAdapter;
  try {
    tested = connectionAdapter(deps, tenantId, conn, creds);
  } catch (e) {
    await recordConnectionTest(deps.db, tenantId, connectionId, {
      ok: false,
      reason:
        e instanceof Error && /incomplete/.test(e.message) ? REASONS.unauthorized : REASONS.unknown,
    });
    return;
  }
  const result = await tested.test();
  const manifest = manifestFor(conn.connectorId);
  // What the account holds (OB2 "Vi fandt … ordrer"), only where the manifest says it can count.
  const counts = result.ok ? await countRecords(tested, manifest?.counts) : {};
  await recordConnectionTest(
    deps.db,
    tenantId,
    connectionId,
    result.ok
      ? { ok: true, accountId: result.account.id, accountName: result.account.name, counts }
      : { ok: false, reason: REASONS[result.reason] },
  );
  if (result.ok) {
    // Live lookups the editor maps against (chart of accounts, §4.5), cached per connection.
    const lists = new Set<LookupId>([
      ...Object.values(manifest?.mapping ?? {})
        .flat()
        .flatMap((g) => g!.fields.map((f) => f.lookup))
        .filter((x): x is LookupId => Boolean(x)),
      ...(manifest?.lookups ?? []),
      // The system's own fields behind dynamic variables and targets (Odoo custom fields).
      ...[...(manifest?.outputs ?? []), ...(manifest?.inputs ?? [])]
        .flatMap((p) => [...(p.dynamicVariables ?? []), ...(p.dynamicTargets ?? [])])
        .map((c): LookupId => `fields:${c.model}`),
    ]);
    for (const list of lists) {
      // One list the system won't give (a missing permission) must not fail the connection.
      try {
        await saveLookup(deps.db, tenantId, connectionId, list, await tested.lookup(list));
      } catch (e) {
        deps.log.warn(
          { tenantId, connectionId, list, err: e instanceof Error ? e.message.slice(0, 200) : e },
          'lookup failed',
        );
      }
    }
    // Webhooks in the shop (PLAN §4.5): registered, and switched back on after failures.
    if (manifest?.webhook && tested.ensureWebhooks) {
      try {
        const hooks = await tested.ensureWebhooks();
        await saveLookup(
          deps.db,
          tenantId,
          connectionId,
          'webhooks',
          hooks.map((h) => ({ value: h.topic, label: h.status })),
        );
      } catch (e) {
        deps.log.warn(
          { tenantId, connectionId, err: e instanceof Error ? e.message.slice(0, 200) : e },
          'webhook registration failed',
        );
        await saveLookup(deps.db, tenantId, connectionId, 'webhooks', [
          { value: 'error', label: e instanceof Error ? e.message.slice(0, 200) : 'failed' },
        ]);
      }
    }
    await resolveNotifications(deps.db, tenantId, { connectionId });
  } else {
    await notify(deps.db, tenantId, {
      event: 'connection_broken',
      messageKey: 'connectionBroken',
      params: { connector: manifest?.name ?? conn.connectorId, name: conn.name },
      href: `/connections/${connectionId}`,
      needsAction: true,
      connectionId,
    });
  }
  deps.log.info({ tenantId, connectionId, ok: result.ok }, 'connection tested');
}

/**
 * Verifies a stored webhook against the connection's signing secret, drops a repeated delivery,
 * and starts a run of every published flow that reads the changed entity from this connection.
 * The run reads just the named records; the idempotency key drops versions already handled.
 */
async function verifyWebhook(deps: ConnectionDeps, tenantId: string, eventId: string) {
  const event = await loadInboundEvent(deps.db, tenantId, eventId);
  if (!event || event.status !== 'queued') return;
  const conn = await loadConnectionForWorker(deps.db, tenantId, event.connectionId);
  const manifest = conn ? manifestFor(conn.connectorId) : null;
  if (!conn || !manifest?.webhook) {
    await markInboundEvent(deps.db, tenantId, eventId, 'rejected', 'no webhook for connector');
    return;
  }
  const creds = await credentials(deps, tenantId, conn.id);
  const secret = creds?.webhookSecret ?? creds?.consumerSecret ?? '';
  const ok = verifyWebhookSignature(
    event.body,
    event.headers[manifest.webhook.signatureHeader],
    secret,
  );
  await markInboundEvent(
    deps.db,
    tenantId,
    eventId,
    ok ? 'accepted' : 'rejected',
    ok ? null : 'bad signature',
  );
  if (!ok) {
    deps.log.warn({ tenantId, connectionId: conn.id }, 'webhook signature rejected');
    return;
  }
  const adapter = connectionAdapter(deps, tenantId, conn, creds ?? {});
  const change = adapter.parseWebhook(event.body.toString('utf8'), event.headers);
  if (!change || change.sourceIds.length === 0) return;
  if (change.deliveryId && !(await markDelivery(deps.db, tenantId, eventId, change.deliveryId))) {
    deps.log.info({ tenantId, connectionId: conn.id }, 'duplicate webhook delivery dropped');
    return;
  }
  if (!deps.flowQueue) return;
  for (const f of await flowsReading(deps.db, tenantId, conn.id)) {
    const def = parseDefinition(f.definition);
    const live = def.routes.filter((r) => !r.paused);
    if (live.some((r) => r.entity === change.entity)) {
      const runId = await createEngineRun(deps.db, tenantId, f.flowId, 'webhook', {
        entity: change.entity,
        ids: change.sourceIds,
      });
      if (runId) await enqueueFlowRun(deps.flowQueue, { tenantId, runId });
    }
    // E.g. WooCommerce refunds come as order.updated: a cursor poll picks them up.
    if (live.some((r) => change.alsoPoll?.includes(r.entity))) {
      const runId = await createEngineRun(deps.db, tenantId, f.flowId, 'webhook');
      if (runId) await enqueueFlowRun(deps.flowQueue, { tenantId, runId });
    }
  }
}

export async function processConnectionJob(deps: ConnectionDeps, name: string, data: unknown) {
  switch (name as ConnectionJobName) {
    case 'connection.test': {
      const d = parseConnectionJob('connection.test', data);
      return testConnection(deps, d.tenantId, d.connectionId);
    }
    case 'webhook.received': {
      const d = parseConnectionJob('webhook.received', data);
      return verifyWebhook(deps, d.tenantId, d.eventId);
    }
    case 'connection.webhook': {
      const d = parseConnectionJob('connection.webhook', data);
      if (!(await loadConnectionForWorker(deps.db, d.tenantId, d.connectionId))) return;
      await persistCredentials(deps, d.tenantId, d.connectionId, { webhookUrl: d.webhookUrl });
      return testConnection(deps, d.tenantId, d.connectionId);
    }
    default:
      throw new Error(`unknown connection job ${name}`);
  }
}
