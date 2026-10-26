import { desc, eq, sql } from 'drizzle-orm';
import { withoutTenant, type Database, type Transaction } from '../client.js';
import {
  incidents,
  planPriceVersions,
  platformAudit,
  supportPriceVersions,
  type IncidentKind,
  type IncidentStatus,
  type PriceAppliesTo,
} from '../schema/index.js';
import { PlatformError, type StaffActor } from './platform.js';

/**
 * Administration (README decision 24, PLAN-2026-10-21 M2): price versions for plans and support
 * (A2), incidents and counts for System Status (A1). Superadmin only; every change is written to
 * the platform audit log in the same transaction.
 */

const asStaff = <T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>) =>
  withoutTenant(db, fn, userId);

function requireSuperadmin(actor: StaffActor) {
  if (actor.role !== 'superadmin') throw new PlatformError('NOT_SUPERADMIN');
}

async function log(
  tx: Transaction,
  actor: StaffActor,
  action: string,
  detail: Record<string, unknown>,
) {
  await tx
    .insert(platformAudit)
    .values({ actorUserId: actor.userId, actorName: actor.name, action, detail });
}

/* ---- Plan price versions (A2 Abonnementer) ------------------------------------------------------ */

export interface PlanPriceVersion {
  id: string;
  planId: string;
  priceMonthlyOre: number;
  entitlements: Record<string, unknown>;
  appliesTo: PriceAppliesTo;
  effectiveFrom: Date;
  noticeSentAt: Date | null;
  createdByName: string;
  createdAt: Date;
}

/** All versions, newest first (the "Historik" panel and the price of each subscription). */
export async function listPlanVersions(db: Database): Promise<PlanPriceVersion[]> {
  const rows = await withoutTenant(db, (tx) =>
    tx.select().from(planPriceVersions).orderBy(desc(planPriceVersions.createdAt)),
  );
  return rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    priceMonthlyOre: r.priceMonthlyOre,
    entitlements: r.entitlements,
    appliesTo: r.appliesTo,
    effectiveFrom: r.effectiveFrom,
    noticeSentAt: r.noticeSentAt,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  }));
}

/** Plan keys Superadmin may change on A2 (beyond the price). Null means unlimited. */
export const PLAN_VALUE_KEYS = [
  'seats',
  'transactions_per_month',
  'integration_sets',
  'destinations_per_flow',
  'polling_interval_minutes',
  'payload_retention_days',
  'trial_days',
  'features',
] as const;
export type PlanValueKey = (typeof PLAN_VALUE_KEYS)[number];

/**
 * Saves a plan as a new price version (A2 "Gem ændringer"). "new": only new subscriptions get it;
 * "all_from_renewal": existing ones move at their first renewal after the notice period.
 */
export async function createPlanVersion(
  db: Database,
  actor: StaffActor,
  input: {
    planId: string;
    priceMonthlyOre: number;
    values: Partial<Record<PlanValueKey, unknown>>;
    appliesTo: PriceAppliesTo;
  },
): Promise<string> {
  requireSuperadmin(actor);
  for (const k of Object.keys(input.values))
    if (!(PLAN_VALUE_KEYS as readonly string[]).includes(k)) throw new PlatformError('INVALID');
  return asStaff(db, actor.userId, async (tx) => {
    const res = await tx.execute<{ id: string }>(
      sql`select app.platform_price_version_create(${input.planId}, ${input.priceMonthlyOre}::int, ${JSON.stringify(input.values)}::jsonb, ${input.appliesTo}, ${actor.name}) as id`,
    );
    const id = res.rows[0]!.id;
    await log(tx, actor, 'price_version.created', { versionId: id, ...input });
    return id;
  });
}

/** "Kunderne får besked på e-mail": stamps the version once the notices are sent. */
export async function markPriceNoticeSent(
  db: Database,
  actor: StaffActor,
  versionId: string,
  recipients: number,
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, async (tx) => {
    await tx.execute(sql`select app.platform_price_notice_sent(${versionId}::uuid)`);
    await log(tx, actor, 'price_version.notice_sent', { versionId, recipients });
  });
}

/* ---- Support price versions (A2 Supportpris) --------------------------------------------------- */

export interface SupportPriceVersion {
  id: string;
  rateOre: number;
  roundingMinutes: number;
  nonBillable: string[];
  effectiveFrom: Date;
  createdByName: string;
  createdAt: Date;
}

export async function listSupportVersions(
  db: Database,
  actor: StaffActor,
): Promise<SupportPriceVersion[]> {
  const rows = await asStaff(db, actor.userId, (tx) =>
    tx.select().from(supportPriceVersions).orderBy(desc(supportPriceVersions.createdAt)),
  );
  return rows.map((r) => ({
    id: r.id,
    rateOre: r.rateOre,
    roundingMinutes: r.roundingMinutes,
    nonBillable: r.nonBillable,
    effectiveFrom: r.effectiveFrom,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  }));
}

export const NON_BILLABLE_REASONS = ['agentor_error', 'goodwill'] as const;

/** A new support price; it applies from `effectiveFrom` (the 1st of the next billing period). */
export async function createSupportVersion(
  db: Database,
  actor: StaffActor,
  input: { rateOre: number; roundingMinutes: number; nonBillable: string[]; effectiveFrom: Date },
): Promise<void> {
  requireSuperadmin(actor);
  if (
    !Number.isInteger(input.rateOre) ||
    input.rateOre < 0 ||
    input.rateOre > 10_000_000 ||
    ![1, 5, 6, 10, 15, 30, 60].includes(input.roundingMinutes) ||
    input.nonBillable.some((r) => !(NON_BILLABLE_REASONS as readonly string[]).includes(r))
  )
    throw new PlatformError('INVALID');
  await asStaff(db, actor.userId, async (tx) => {
    await tx.insert(supportPriceVersions).values({
      rateOre: input.rateOre,
      roundingMinutes: input.roundingMinutes,
      nonBillable: input.nonBillable,
      effectiveFrom: input.effectiveFrom,
      createdBy: actor.userId,
      createdByName: actor.name,
    });
    await log(tx, actor, 'support_price.created', {
      ...input,
      effectiveFrom: input.effectiveFrom.toISOString(),
    });
  });
}

/** The support price in force at a moment (the start of the month being billed). */
export async function supportPriceAt(
  db: Database,
  userId: string,
  at: Date,
): Promise<{ rateOre: number; roundingMinutes: number } | null> {
  const res = await asStaff(db, userId, (tx) =>
    tx.execute<{ rate_ore: number; rounding_minutes: number }>(
      sql`select * from app.support_price_at(${at})`,
    ),
  );
  const r = res.rows[0];
  return r ? { rateOre: Number(r.rate_ore), roundingMinutes: Number(r.rounding_minutes) } : null;
}

/* ---- Incidents (A1, MP25) ------------------------------------------------------------------------ */

export interface Incident {
  id: string;
  kind: IncidentKind;
  title: string;
  impact: string;
  status: IncidentStatus;
  startsAt: Date;
  endsAt: Date | null;
  notes: string;
  createdByName: string;
  updatedAt: Date;
}

export async function listIncidents(db: Database, actor: StaffActor): Promise<Incident[]> {
  requireSuperadmin(actor);
  return asStaff(db, actor.userId, (tx) =>
    tx
      .select({
        id: incidents.id,
        kind: incidents.kind,
        title: incidents.title,
        impact: incidents.impact,
        status: incidents.status,
        startsAt: incidents.startsAt,
        endsAt: incidents.endsAt,
        notes: incidents.notes,
        createdByName: incidents.createdByName,
        updatedAt: incidents.updatedAt,
      })
      .from(incidents)
      .orderBy(desc(incidents.startsAt))
      .limit(50),
  );
}

export interface IncidentInput {
  kind: IncidentKind;
  title: string;
  impact: string;
  status: IncidentStatus;
  startsAt: Date;
  endsAt: Date | null;
  notes: string;
}

function checkIncident(input: IncidentInput) {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new PlatformError('INVALID');
  if (input.endsAt && input.endsAt < input.startsAt) throw new PlatformError('INVALID');
  if (input.impact.length > 300 || input.notes.length > 2000) throw new PlatformError('INVALID');
}

export async function createIncident(
  db: Database,
  actor: StaffActor,
  input: IncidentInput,
): Promise<string> {
  requireSuperadmin(actor);
  checkIncident(input);
  return asStaff(db, actor.userId, async (tx) => {
    const [row] = await tx
      .insert(incidents)
      .values({
        ...input,
        title: input.title.trim(),
        createdBy: actor.userId,
        createdByName: actor.name,
      })
      .returning({ id: incidents.id });
    await log(
      tx,
      actor,
      input.kind === 'maintenance' ? 'maintenance.planned' : 'incident.created',
      {
        incidentId: row!.id,
        title: input.title.trim(),
        status: input.status,
      },
    );
    return row!.id;
  });
}

export async function updateIncident(
  db: Database,
  actor: StaffActor,
  id: string,
  input: IncidentInput,
): Promise<void> {
  requireSuperadmin(actor);
  checkIncident(input);
  await asStaff(db, actor.userId, async (tx) => {
    const res = await tx
      .update(incidents)
      .set({ ...input, title: input.title.trim(), updatedAt: new Date() })
      .where(eq(incidents.id, id))
      .returning({ id: incidents.id });
    if (!res.length) throw new PlatformError('NOT_FOUND');
    await log(tx, actor, 'incident.updated', { incidentId: id, status: input.status });
  });
}

/* ---- System Status counts (A1) ------------------------------------------------------------------ */

export interface StatusCounts {
  runsLastHour: number;
  runsFailedLastHour: number;
  webhooksToday: number;
  webhooksRejectedToday: number;
}

export async function statusCounts(
  db: Database,
  actor: StaffActor,
  sinceRuns: Date,
  sinceHooks: Date,
): Promise<StatusCounts> {
  requireSuperadmin(actor);
  const res = await asStaff(db, actor.userId, (tx) =>
    tx.execute<{
      runs: number;
      runs_failed: number;
      webhooks: number;
      webhooks_rejected: number;
    }>(sql`select * from app.platform_status_counts(${sinceRuns}, ${sinceHooks})`),
  );
  const r = res.rows[0]!;
  return {
    runsLastHour: Number(r.runs),
    runsFailedLastHour: Number(r.runs_failed),
    webhooksToday: Number(r.webhooks),
    webhooksRejectedToday: Number(r.webhooks_rejected),
  };
}

/** Audit of exports (A3, A4, F7): who exported which report, period and format. */
export async function logExport(
  db: Database,
  actor: StaffActor,
  detail: { report: string; format: 'csv' | 'pdf'; from: string; to: string; rows: number },
): Promise<void> {
  requireSuperadmin(actor);
  await asStaff(db, actor.userId, (tx) => log(tx, actor, 'report.exported', detail));
}

/** Connections per connector across customers (A1 Connectors), counts only. */
export interface ConnectorStatus {
  connectorId: string;
  connections: number;
  broken: number;
  checking: number;
  lastCheckedAt: Date | null;
  brokenSince: Date | null;
}

export async function connectorStatus(db: Database, actor: StaffActor): Promise<ConnectorStatus[]> {
  requireSuperadmin(actor);
  const res = await asStaff(db, actor.userId, (tx) =>
    tx.execute<{
      connector_id: string;
      connections: number;
      broken: number;
      checking: number;
      last_checked_at: Date | null;
      broken_since: Date | null;
    }>(sql`select * from app.platform_connector_status()`),
  );
  const by = new Map<string, ConnectorStatus>();
  for (const r of res.rows) {
    const cur = by.get(r.connector_id) ?? {
      connectorId: r.connector_id,
      connections: 0,
      broken: 0,
      checking: 0,
      lastCheckedAt: null,
      brokenSince: null,
    };
    cur.connections += Number(r.connections);
    cur.broken += Number(r.broken);
    cur.checking += Number(r.checking);
    const checked = r.last_checked_at ? new Date(r.last_checked_at) : null;
    if (checked && (!cur.lastCheckedAt || checked > cur.lastCheckedAt)) cur.lastCheckedAt = checked;
    const since = r.broken_since ? new Date(r.broken_since) : null;
    if (since && (!cur.brokenSince || since < cur.brokenSince)) cur.brokenSince = since;
    by.set(r.connector_id, cur);
  }
  return [...by.values()].sort((a, b) => a.connectorId.localeCompare(b.connectorId));
}

/** A staff member's own change (profile, password, 2FA, passkeys, sessions) in the platform audit log. */
export async function logStaffEvent(
  db: Database,
  actor: StaffActor,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await asStaff(db, actor.userId, (tx) => log(tx, actor, action, detail));
}
