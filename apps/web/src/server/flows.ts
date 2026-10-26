import { manifestFor } from '@agentor/connectors';
import type { Status } from '@agentor/core';
import { connectionStates, getTenantThresholds, listFlows, type FlowRow } from '@agentor/db';
import {
  flowMode,
  flowStatus,
  parseDefinition,
  routeStatus,
  type FlowDefinition,
  type RouteMode,
} from '@agentor/flows';
import { cache } from 'react';
import type { AppContext } from './auth/session';
import { db } from './infra';

/**
 * View models for flows (D1, D2, D7): definitions parsed, statuses rolled up from routes,
 * connections and open failures, and labels in each system's own words.
 */

export interface ConnectionRef {
  id: string;
  connectorId: string;
  name: string;
  logo: string;
  status: 'ok' | 'broken' | 'checking';
  brokenSince: Date | null;
  /** From the last connection test, where the connector can count (OB2). */
  recordCounts?: Partial<Record<string, number>> | null;
}

export interface RouteView {
  id: string;
  /** "Ordrer" (source port). */
  source: string;
  /** "Dinero Fakturaer". */
  destination: string;
  destinationConnector: ConnectionRef | null;
  status: Status;
  mode: RouteMode;
  records: number;
  failed: number;
  openFailures: number;
  lastAt: Date | null;
  pausedBy: string | null;
  pausedAt: string | null;
}

export interface FlowView {
  id: string;
  name: string;
  status: Status;
  /** When the status started (e.g. the first open failure or the connection breaking). */
  statusSince: Date | null;
  mode: ReturnType<typeof flowMode>;
  definition: FlowDefinition | null;
  routes: RouteView[];
  source: ConnectionRef | null;
  destinations: ConnectionRef[];
  records: number;
  openFailures: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  pausedAt: Date | null;
  pausedByName: string | null;
  published: FlowRow['published'];
  hasDraft: boolean;
  draftLockedBy: string | null;
  /** The open draft (mobile MA20/MA22/MA23 test and publish it as it is). */
  draft: { id: string; definition: FlowDefinition | null } | null;
  template: string | null;
}

function safeParse(raw: Record<string, unknown> | undefined) {
  if (!raw) return null;
  try {
    return parseDefinition(raw);
  } catch {
    return null;
  }
}

export function toView(
  f: FlowRow,
  conns: Map<string, ConnectionRef>,
  warnErrorRate: number,
): FlowView {
  const def = safeParse(f.published?.definition ?? f.draft?.definition);
  const broken = new Set([...conns.values()].filter((c) => c.status === 'broken').map((c) => c.id));
  const health = Object.fromEntries(
    Object.entries(f.routes).map(([id, s]) => [
      id,
      { openFailures: s.openFailures, errorRate: s.records ? s.failed / s.records : 0 },
    ]),
  );
  const ctx = {
    published: Boolean(f.published),
    flowPaused: f.pausedAt !== null,
    brokenConnections: broken,
    health,
    warnErrorRate,
  };
  const defWithPauses: FlowDefinition | null = def
    ? {
        ...def,
        routes: def.routes.map((r) => ({ ...r, paused: r.paused || Boolean(f.routePauses[r.id]) })),
      }
    : null;
  const nodeConn = (nodeId: string) => {
    const n = def?.nodes.find((x) => x.id === nodeId);
    return n ? (conns.get(n.connectionId) ?? null) : null;
  };
  const routes: RouteView[] = (defWithPauses?.routes ?? []).map((r) => {
    const src = nodeConn(r.from);
    const dst = nodeConn(r.to);
    const sm = src ? manifestFor(src.connectorId) : null;
    const dm = dst ? manifestFor(dst.connectorId) : null;
    const s = f.routes[r.id];
    return {
      id: r.id,
      source: sm?.outputs.find((p) => p.entity === r.entity)?.label ?? r.entity,
      destination:
        `${dm?.name ?? ''} ${dm?.inputs.find((p) => p.entity === r.targetEntity)?.label ?? r.targetEntity}`.trim(),
      destinationConnector: dst,
      status: routeStatus(defWithPauses!, r, ctx),
      mode: r.mode,
      records: s?.records ?? 0,
      failed: s?.failed ?? 0,
      openFailures: s?.openFailures ?? 0,
      lastAt: s?.lastAt ?? null,
      pausedBy: f.routePauses[r.id]?.by ?? null,
      pausedAt: f.routePauses[r.id]?.at ?? null,
    };
  });
  const status = flowStatus(defWithPauses, ctx);
  const source = def ? nodeConn(def.nodes.find((n) => n.role === 'source')?.id ?? '') : null;
  const destinations = (def?.nodes ?? [])
    .filter((n) => n.role === 'destination')
    .map((n) => conns.get(n.connectionId))
    .filter((c): c is ConnectionRef => Boolean(c));
  const brokenHere = [source, ...destinations].filter((c) => c?.status === 'broken');
  return {
    id: f.id,
    name: f.name,
    status,
    statusSince:
      status === 'broken'
        ? (brokenHere[0]?.brokenSince ?? null)
        : status === 'paused'
          ? f.pausedAt
          : status === 'error'
            ? (routes
                .filter((r) => r.openFailures > 0)
                .map((r) => r.lastAt)
                .sort()[0] ?? null)
            : null,
    mode: flowMode(def),
    definition: def,
    routes,
    source,
    destinations,
    records: routes.reduce((s, r) => s + r.records, 0),
    openFailures: routes.reduce((s, r) => s + r.openFailures, 0),
    lastRunAt: f.lastRunAt,
    nextRunAt: f.nextRunAt,
    pausedAt: f.pausedAt,
    pausedByName: f.pausedByName,
    published: f.published,
    hasDraft: Boolean(f.draft),
    draftLockedBy: f.draft?.lockedByName ?? null,
    draft: f.draft ? { id: f.draft.id, definition: safeParse(f.draft.definition) } : null,
    template: f.template,
  };
}

export const connectionMap = cache(async (tenantId: string, userId: string) => {
  const rows = await connectionStates(db(), { tenantId, userId });
  return new Map<string, ConnectionRef>(
    rows.map((c) => [
      c.id,
      {
        id: c.id,
        connectorId: c.connectorId,
        name: c.name,
        logo: manifestFor(c.connectorId)?.logo ?? '',
        status: c.status,
        brokenSince: c.brokenSince,
        recordCounts: c.recordCounts,
      },
    ]),
  );
});

export const PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30 } as const;
export type PeriodKey = keyof typeof PERIOD_DAYS;
export const periodOf = (v: string | undefined): PeriodKey =>
  v === 'today' || v === '30d' ? v : '7d';

/** All flows the user may see, as view models, for a period (cached per request). */
export const flowViews = cache(async (tenantId: string, userId: string, days: number) => {
  const [rows, conns, thresholds] = await Promise.all([
    listFlows(db(), { tenantId, userId }, new Date(Date.now() - days * 86_400_000)),
    connectionMap(tenantId, userId),
    getTenantThresholds(db(), { tenantId, userId }),
  ]);
  return rows.map((f) => toView(f, conns, thresholds.errorRatePct / 100));
});

export const viewsFor = (ctx: AppContext, days = 7) =>
  flowViews(ctx.tenant.tenantId, ctx.user.id, days);

export const NEEDS_ACTION: Status[] = ['broken', 'error', 'warn'];
