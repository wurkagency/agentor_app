import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { withTenant, type Database, type Transaction } from '../client.js';
import {
  connections,
  connectionSecrets,
  inboundEvents,
  tenantKeys,
  type ConnectionStatus,
} from '../schema/index.js';
import { writeAudit, writeSystemAudit, type Actor } from './audit.js';

type Ctx = { tenantId: string; userId: string };

export class ConnectionError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN') {
    super(code);
    this.name = 'ConnectionError';
  }
}

export interface SealedSecret {
  format: string;
  nonce: Buffer;
  ciphertext: Buffer;
}

/* ---- Web: read --------------------------------------------------------------------------------- */

export interface ConnectionRow {
  id: string;
  connectorId: string;
  name: string;
  status: ConnectionStatus;
  statusReason: string | null;
  brokenSince: Date | null;
  accountId: string | null;
  connectorVersion: string;
  configuredByName: string | null;
  createdAt: Date;
  lastCheckedAt: Date | null;
  lastWebhookAt: Date | null;
  tokenExpiresAt: Date | null;
  /** Flows using the connection (filled once flows reference connections, M6). */
  usedInFlows: number;
}

const columns = {
  id: connections.id,
  connectorId: connections.connectorId,
  name: connections.name,
  status: connections.status,
  statusReason: connections.statusReason,
  brokenSince: connections.brokenSince,
  accountId: connections.accountId,
  connectorVersion: connections.connectorVersion,
  configuredByName: connections.configuredByName,
  createdAt: connections.createdAt,
  lastCheckedAt: connections.lastCheckedAt,
  lastWebhookAt: connections.lastWebhookAt,
  tokenExpiresAt: connections.tokenExpiresAt,
};

/** How many flows use a connection in their published version or draft (D9 "Bruges i N flows"). */
async function countUsage(tx: Transaction, connectionId: string): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(distinct v.flow_id)::int as n from flow_versions v
     where v.state in ('published', 'draft')
       and v.definition -> 'nodes' @> ${JSON.stringify([{ connectionId }])}::jsonb`);
  return res.rows[0]?.n ?? 0;
}

export async function listConnections(db: Database, ctx: Ctx): Promise<ConnectionRow[]> {
  return withTenant(db, ctx, async (tx) => {
    const rows = await tx
      .select(columns)
      .from(connections)
      .orderBy(asc(connections.connectorId), asc(connections.name));
    // One query at a time: a transaction is a single connection, and pg doesn't pipeline.
    const out: ConnectionRow[] = [];
    for (const r of rows) out.push({ ...r, usedInFlows: await countUsage(tx, r.id) });
    return out;
  });
}

export async function getConnection(
  db: Database,
  ctx: Ctx,
  id: string,
): Promise<ConnectionRow | null> {
  return withTenant(db, ctx, async (tx) => {
    const [r] = await tx.select(columns).from(connections).where(eq(connections.id, id));
    return r ? { ...r, usedInFlows: await countUsage(tx, r.id) } : null;
  });
}

/* ---- Web: change ------------------------------------------------------------------------------- */

export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * Adds a connection with its sealed credentials (the web process can't open them). Sources
 * that push get an unguessable webhook token; only its hash is stored.
 */
export async function createConnection(
  db: Database,
  actor: Actor,
  input: {
    connectorId: string;
    name: string;
    version: string;
    secretFor: (connectionId: string) => SealedSecret;
    webhook: boolean;
  },
): Promise<{ id: string; webhookToken: string | null }> {
  return withTenant(db, actor, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        tenantId: actor.tenantId,
        connectorId: input.connectorId,
        name: input.name,
        status: 'checking',
        connectorVersion: input.version,
        configuredBy: actor.userId,
        configuredByName: actor.name,
      })
      .returning({ id: connections.id });
    const id = row!.id;
    // The ciphertext is bound to (tenant, connection), so it is sealed once the id exists.
    const s = input.secretFor(id);
    await tx.execute(
      sql`select app.insert_connection_secret(${id}, ${s.format}, null, ${s.nonce}, ${s.ciphertext})`,
    );
    let webhookToken: string | null = null;
    if (input.webhook) {
      webhookToken = randomBytes(32).toString('base64url');
      await tx.execute(sql`select app.register_webhook(${hashWebhookToken(webhookToken)}, ${id})`);
    }
    await writeAudit(tx, actor, {
      action: 'connection.created',
      objectType: 'connection',
      objectId: id,
      after: { connector: input.connectorId, name: input.name },
    });
    return { id, webhookToken };
  });
}

/** New credentials for an existing connection (Genautentificér). */
export async function reauthorizeConnection(
  db: Database,
  actor: Actor,
  id: string,
  secretFor: (connectionId: string) => SealedSecret,
): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(connections)
      .set({ status: 'checking', updatedAt: new Date() })
      .where(eq(connections.id, id))
      .returning({ id: connections.id });
    if (!res.length) throw new ConnectionError('NOT_FOUND');
    const s = secretFor(id);
    await tx.execute(
      sql`select app.insert_connection_secret(${id}, ${s.format}, null, ${s.nonce}, ${s.ciphertext})`,
    );
    await writeAudit(tx, actor, {
      action: 'connection.reauthorized',
      objectType: 'connection',
      objectId: id,
    });
  });
}

/** Marks a connection for a fresh test (Test forbindelse). */
export async function requestConnectionTest(db: Database, actor: Actor, id: string) {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .update(connections)
      .set({ status: 'checking', updatedAt: new Date() })
      .where(and(eq(connections.id, id), ne(connections.status, 'checking')))
      .returning({ id: connections.id });
    if (!res.length) {
      const [exists] = await tx
        .select({ id: connections.id })
        .from(connections)
        .where(eq(connections.id, id));
      if (!exists) throw new ConnectionError('NOT_FOUND');
    }
  });
}

/** New webhook address; the old one stops working at once. */
export async function rotateWebhookToken(db: Database, actor: Actor, id: string): Promise<string> {
  return withTenant(db, actor, async (tx) => {
    const token = randomBytes(32).toString('base64url');
    await tx.execute(sql`select app.register_webhook(${hashWebhookToken(token)}, ${id})`);
    await writeAudit(tx, actor, {
      action: 'connection.webhook_rotated',
      objectType: 'connection',
      objectId: id,
    });
    return token;
  });
}

export async function deleteConnection(db: Database, actor: Actor, id: string): Promise<void> {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .delete(connections)
      .where(eq(connections.id, id))
      .returning({ name: connections.name, connectorId: connections.connectorId });
    if (!res.length) throw new ConnectionError('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: 'connection.deleted',
      objectType: 'connection',
      objectId: id,
      before: { connector: res[0]!.connectorId, name: res[0]!.name },
    });
  });
}

/* ---- Worker: key box and test results ---------------------------------------------------------- */

export interface WorkerConnection {
  id: string;
  connectorId: string;
  name: string;
  status: ConnectionStatus;
  secret: (SealedSecret & { id: string; keyId: string | null }) | null;
}

/** The connection and its newest secret (worker role only can read secrets). */
export async function loadConnectionForWorker(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<WorkerConnection | null> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [c] = await tx
      .select({
        id: connections.id,
        connectorId: connections.connectorId,
        name: connections.name,
        status: connections.status,
      })
      .from(connections)
      .where(eq(connections.id, connectionId));
    if (!c) return null;
    const [s] = await tx
      .select()
      .from(connectionSecrets)
      .where(eq(connectionSecrets.connectionId, connectionId))
      .orderBy(desc(connectionSecrets.createdAt), desc(connectionSecrets.id))
      .limit(1);
    return {
      ...c,
      secret: s
        ? { id: s.id, format: s.format, nonce: s.nonce, ciphertext: s.ciphertext, keyId: s.keyId }
        : null,
    };
  });
}

/** The tenant's active DEK, created (sealed to the KEK) on first use. */
export async function tenantDek(
  db: Database,
  tenantId: string,
  create: () => { wrapped: Buffer; kekId: string },
): Promise<{ id: string; wrapped: Buffer; created: boolean }> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [k] = await tx
      .select({ id: tenantKeys.id, wrapped: tenantKeys.wrappedDek })
      .from(tenantKeys)
      .where(isNull(tenantKeys.retiredAt))
      .orderBy(desc(tenantKeys.createdAt))
      .limit(1);
    if (k) return { ...k, created: false };
    const { wrapped, kekId } = create();
    const [row] = await tx
      .insert(tenantKeys)
      .values({ tenantId, kekId, wrappedDek: wrapped })
      .returning({ id: tenantKeys.id });
    return { id: row!.id, wrapped, created: true };
  });
}

/** Replaces a connection's secrets with one encrypted under the tenant DEK. */
export async function storeDekSecret(
  db: Database,
  tenantId: string,
  connectionId: string,
  keyId: string,
  env: SealedSecret,
): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    await tx.delete(connectionSecrets).where(eq(connectionSecrets.connectionId, connectionId));
    await tx.insert(connectionSecrets).values({
      tenantId,
      connectionId,
      format: env.format,
      keyId,
      nonce: env.nonce,
      ciphertext: env.ciphertext,
    });
  });
}

export async function recordConnectionTest(
  db: Database,
  tenantId: string,
  connectionId: string,
  result: { ok: true; accountId: string; accountName: string } | { ok: false; reason: string },
  now = new Date(),
): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    const [before] = await tx
      .select({ status: connections.status, brokenSince: connections.brokenSince })
      .from(connections)
      .where(eq(connections.id, connectionId));
    if (!before) return;
    if (result.ok) {
      await tx
        .update(connections)
        .set({
          status: 'ok',
          statusReason: null,
          brokenSince: null,
          accountId: result.accountId,
          name: result.accountName,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(connections.id, connectionId));
    } else {
      await tx
        .update(connections)
        .set({
          status: 'broken',
          statusReason: result.reason,
          brokenSince: before.brokenSince ?? now,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(connections.id, connectionId));
    }
    // Audit the transitions the customer cares about: it broke, or it works again.
    const wasBroken = before.brokenSince !== null;
    if (wasBroken === result.ok) {
      await writeSystemAudit(tx, tenantId, {
        action: result.ok ? 'connection.restored' : 'connection.broken',
        objectType: 'connection',
        objectId: connectionId,
      });
    }
  });
}

export async function loadInboundEvent(db: Database, tenantId: string, eventId: string) {
  return withTenant(db, { tenantId }, async (tx) => {
    const [e] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId));
    return e ?? null;
  });
}

export async function markInboundEvent(
  db: Database,
  tenantId: string,
  eventId: string,
  status: 'accepted' | 'rejected',
  reason: string | null,
): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    const [e] = await tx
      .update(inboundEvents)
      .set({ status, reason })
      .where(eq(inboundEvents.id, eventId))
      .returning({
        connectionId: inboundEvents.connectionId,
        receivedAt: inboundEvents.receivedAt,
      });
    if (e && status === 'accepted') {
      await tx
        .update(connections)
        .set({ lastWebhookAt: e.receivedAt })
        .where(eq(connections.id, e.connectionId));
    }
  });
}

/** Called by agentor-ingest: stores the event for a known token; null for unknown tokens. */
export async function ingestWebhook(
  db: Database,
  token: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ eventId: string; tenantId: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const res = await db.execute<{ event_id: string; tenant_id: string }>(
    sql`select * from app.ingest_webhook(${hashWebhookToken(token)}, ${JSON.stringify(headers)}::jsonb, ${body})`,
  );
  const r = res.rows[0];
  return r ? { eventId: r.event_id, tenantId: r.tenant_id } : null;
}
