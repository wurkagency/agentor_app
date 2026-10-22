import { adapterFor, countRecords, manifestFor, verifyWebhookSignature } from '@agentor/connectors';
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
  const tested = adapterFor({
    connectorId: conn.connectorId,
    credentials: creds,
    mode: deps.connectorMode,
  });
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
    const lists = new Set(
      Object.values(manifest?.mapping ?? {})
        .flat()
        .flatMap((g) => g!.fields.map((f) => f.lookup))
        .filter((x): x is 'accounts' | 'vatCodes' | 'templates' => Boolean(x)),
    );
    const adapter = adapterFor({
      connectorId: conn.connectorId,
      credentials: creds,
      mode: deps.connectorMode,
    });
    for (const list of lists)
      await saveLookup(deps.db, tenantId, connectionId, list, await adapter.lookup(list));
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
  const adapter = adapterFor({
    connectorId: conn.connectorId,
    credentials: creds ?? {},
    mode: deps.connectorMode,
  });
  const change = adapter.parseWebhook(event.body.toString('utf8'), event.headers);
  if (!change || change.sourceIds.length === 0) return;
  if (change.deliveryId && !(await markDelivery(deps.db, tenantId, eventId, change.deliveryId))) {
    deps.log.info({ tenantId, connectionId: conn.id }, 'duplicate webhook delivery dropped');
    return;
  }
  if (!deps.flowQueue) return;
  for (const f of await flowsReading(deps.db, tenantId, conn.id)) {
    const def = parseDefinition(f.definition);
    if (!def.routes.some((r) => r.entity === change.entity && !r.paused)) continue;
    const runId = await createEngineRun(deps.db, tenantId, f.flowId, 'webhook', {
      entity: change.entity,
      ids: change.sourceIds,
    });
    if (runId) await enqueueFlowRun(deps.flowQueue, { tenantId, runId });
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
    default:
      throw new Error(`unknown connection job ${name}`);
  }
}
