import { MANIFESTS } from '@agentor/connectors';
import {
  connectorStatus,
  listIncidents,
  statusCounts,
  type ConnectorStatus,
  type Incident,
  type StaffActor,
  type StatusCounts,
} from '@agentor/db';
import { QUEUES } from '@agentor/jobs';
import { Queue } from 'bullmq';
import { copenhagenToday, parseDateRange } from './date-range';
import { env } from './env';
import { db, redis } from './infra';

/**
 * System Status (A1, MP25): only what Agentor measures today. Uptime over 30 days, queue latency
 * and response times per component or connector are not recorded anywhere yet, so they are
 * reported as null and the page says "Måles ikke endnu" (PLAN-2026-10-21 Q6). Never invented.
 */

export type ComponentState = 'ok' | 'warn' | 'error' | 'unknown';

export interface QueueInfo {
  key: string;
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  workers: number;
}

export interface StatusData {
  checkedAt: Date;
  queues: QueueInfo[];
  schedulerLeader: string | null;
  ingest: { ok: boolean; ms: number | null };
  counts: StatusCounts;
  connectors: (ConnectorStatus & { name: string; version: string })[];
  incidents: Incident[];
  components: { key: string; state: ComponentState; ms: number | null }[];
  overall: ComponentState;
  warnings: number;
  /** Not recorded yet (Q6). */
  uptime30d: null;
  queueLatency: null;
}

async function queues(): Promise<QueueInfo[]> {
  const connection = redis();
  return Promise.all(
    Object.entries(QUEUES).map(async ([key, name]) => {
      const q = new Queue(name, { connection });
      try {
        const [c, workers] = await Promise.all([
          q.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          q.getWorkersCount(),
        ]);
        return {
          key,
          name,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
          workers,
        };
      } finally {
        await q.close().catch(() => undefined);
      }
    }),
  );
}

/** Webhook reception: agentor-ingest's /healthz, timed from here. */
async function ingestHealth(): Promise<{ ok: boolean; ms: number | null }> {
  const started = performance.now();
  try {
    const res = await fetch(new URL('/healthz', env().INGEST_INTERNAL_URL), {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return { ok: res.ok, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, ms: null };
  }
}

export async function statusData(actor: StaffActor, now = new Date()): Promise<StatusData> {
  const today = parseDateRange(copenhagenToday(now), copenhagenToday(now), 1)!;
  const [qs, leader, ingest, counts, conns, incidents] = await Promise.all([
    queues(),
    redis().get('agentor:scheduler:leader'),
    ingestHealth(),
    statusCounts(db(), actor, new Date(now.getTime() - 3_600_000), today.from),
    connectorStatus(db(), actor),
    listIncidents(db(), actor),
  ]);
  const connectors = conns.map((c) => {
    const m = MANIFESTS[c.connectorId];
    return { ...c, name: m?.name ?? c.connectorId, version: m?.version ?? '–' };
  });
  const workersOk = qs.every((q) => q.workers > 0);
  const waiting = qs.reduce((a, q) => a + q.waiting, 0);
  const components: StatusData['components'] = [
    // This page answered, so the app and API are up; no response time is recorded (Q6).
    { key: 'app', state: 'ok', ms: null },
    {
      key: 'runs',
      state: !leader || !workersOk ? 'error' : 'ok',
      ms: null,
    },
    { key: 'webhooks', state: ingest.ok ? 'ok' : 'error', ms: ingest.ms },
    { key: 'queues', state: workersOk ? (waiting > 500 ? 'warn' : 'ok') : 'error', ms: null },
    { key: 'mail', state: 'unknown', ms: null },
    { key: 'payments', state: 'unknown', ms: null },
  ];
  const open = incidents.filter(
    (i) => i.kind === 'incident' && (i.status === 'investigating' || i.status === 'monitoring'),
  );
  const errors =
    components.filter((c) => c.state === 'error').length +
    open.filter((i) => i.status === 'investigating').length;
  const warnings =
    components.filter((c) => c.state === 'warn').length +
    connectors.filter((c) => c.broken > 0).length +
    open.filter((i) => i.status === 'monitoring').length;
  return {
    checkedAt: now,
    queues: qs,
    schedulerLeader: leader,
    ingest,
    counts,
    connectors,
    incidents,
    components,
    overall: errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok',
    warnings: errors + warnings,
    uptime30d: null,
    queueLatency: null,
  };
}
