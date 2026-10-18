import { and, desc, eq, gte, like, lt, sql } from 'drizzle-orm';
import { withTenant, type Database, type Transaction } from '../client.js';
import { auditLog } from '../schema/index.js';

export interface Actor {
  tenantId: string;
  userId: string;
  name: string;
  /** Client IP; stored truncated (see maskIp). */
  ip?: string | null | undefined;
}

/**
 * Data minimisation for the audit log (produktspecifikation §9.6): keep the network, not the
 * host. IPv4 keeps two octets ("87.61.•.•" in D12-Auditlog), IPv6 the first three groups.
 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.');
    return `${a}.${b}.•.•`;
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  return null;
}

/** Values never written to the audit log, however they are nested. */
const SECRET_KEYS = /pass(word)?|secret|token|key|authorization|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? '[skjult]' : redact(v),
      ]),
    );
  }
  return value;
}

export interface AuditEntry {
  action: string;
  objectType: string;
  objectId?: string | null | undefined;
  before?: unknown;
  after?: unknown;
}

/** Appends to the audit log inside the caller's transaction, so the change and its trail commit together. */
export async function writeAudit(tx: Transaction, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorKind: 'user',
    actorName: actor.name,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId ?? null,
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    ip: maskIp(actor.ip),
  });
}

export interface AuditFilter {
  actorUserId?: string | undefined;
  actionPrefix?: string | undefined;
  since?: Date | undefined;
  supportOnly?: boolean | undefined;
  /** Keyset pagination: entries strictly older than this created_at. */
  before?: Date | undefined;
  limit?: number | undefined;
}

export async function listAudit(
  db: Database,
  ctx: { tenantId: string; userId: string },
  f: AuditFilter = {},
) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  return withTenant(db, ctx, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(
        and(
          f.actorUserId ? eq(auditLog.actorUserId, f.actorUserId) : undefined,
          f.actionPrefix
            ? like(auditLog.action, `${f.actionPrefix.replace(/[%_]/g, '')}%`)
            : undefined,
          f.since ? gte(auditLog.createdAt, f.since) : undefined,
          f.supportOnly ? eq(auditLog.actorKind, 'support') : undefined,
          f.before ? lt(auditLog.createdAt, f.before) : undefined,
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(sql`${auditLog.id}`))
      .limit(limit),
  );
}
