import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import {
  claimVersions,
  dueRetries,
  echoes,
  finalFailures,
  insertRouteRecords,
  retentionSweep,
  saveLink,
  type RouteRecordInsert,
} from '../../src/repo/sync.js';
import { roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin } from './helpers.js';

/**
 * The sync engine's state through the repository, as the worker role runs it: the idempotency
 * key, per-record retries with backoff, final failures, echo suppression and retention.
 * Rows it adds are removed afterwards so the other suites see the plain fixtures.
 */

let worker: DatabaseHandle;
const tenantId = ID.tenantA;
const run = { id: ID.runA1, flowId: ID.flowA1, kind: 'scheduled' as const };

beforeAll(() => {
  worker = createDatabase(roleUrl('worker', inject('isolationDb')), { max: 2 });
});
afterAll(async () => {
  await admin(`delete from run_records where tenant_id = $1 and source_id like 'sf-%'`, [tenantId]);
  await admin(`delete from sync_items where tenant_id = $1 and source_id like 'sf-%'`, [tenantId]);
  await admin(`delete from entity_links where tenant_id = $1 and source_id like 'sf-%'`, [
    tenantId,
  ]);
  await admin(`update flows set next_retry_at = null where tenant_id = $1`, [tenantId]);
  await worker?.close();
});

const record = (o: Partial<RouteRecordInsert>): RouteRecordInsert => ({
  routeId: 'r1',
  entity: 'order',
  sourceId: 'sf-1',
  label: '#1',
  outcome: 'failed',
  mode: 'live',
  amountOre: null,
  destinationId: null,
  errorCode: 'DESTINATION_ERROR',
  errorParams: null,
  skipReason: null,
  preview: null,
  debug: null,
  durationMs: 1,
  ...o,
});

describe('sync engine state', () => {
  it('runs each record version once per flow', async () => {
    const key = { flowId: ID.flowA1, connectionId: ID.connA, entity: 'order', runId: ID.runA1 };
    const first = await claimVersions(worker.db, tenantId, key, [
      { sourceId: 'sf-a', version: 'v1' },
      { sourceId: 'sf-b', version: 'v1' },
    ]);
    expect([...first].sort()).toEqual(['sf-a', 'sf-b']);
    // An overlapping poll: sf-a unchanged, sf-b changed.
    const again = await claimVersions(worker.db, tenantId, key, [
      { sourceId: 'sf-a', version: 'v1' },
      { sourceId: 'sf-b', version: 'v2' },
    ]);
    expect([...again]).toEqual(['sf-b']);
  });

  it('retries a transient failure with backoff and stops after 8 tries', async () => {
    const now = new Date('2026-10-19T10:00:00Z');
    for (let i = 1; i <= 8; i++)
      await insertRouteRecords(worker.db, tenantId, run, [record({ failure: 'transient' })], {
        now,
        random: () => 0.5,
      });
    const rows = await admin(
      `select attempts, next_retry_at from run_records where tenant_id = $1 and source_id = 'sf-1' order by attempts`,
      [tenantId],
    );
    expect(rows.rows.map((r) => r.attempts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Only the latest try carries a retry; the 8th has none.
    expect(rows.rows.filter((r) => r.next_retry_at !== null)).toHaveLength(0);
    expect(await finalFailures(worker.db, tenantId, ID.runA1)).toBeGreaterThan(0);
  });

  it('never retries rejected data, and a success resolves the record', async () => {
    const now = new Date();
    const res = await insertRouteRecords(
      worker.db,
      tenantId,
      run,
      [record({ sourceId: 'sf-2', failure: 'invalid', errorCode: 'DESTINATION_REJECTED' })],
      { now },
    );
    expect(res.needsAction).toBe(1);
    await insertRouteRecords(
      worker.db,
      tenantId,
      run,
      [record({ sourceId: 'sf-3', failure: 'transient' })],
      {
        now: new Date(now.getTime() - 5 * 60_000),
      },
    );
    expect(await dueRetries(worker.db, tenantId, ID.flowA1, now)).toContainEqual({
      routeId: 'r1',
      entity: 'order',
      sourceId: 'sf-3',
    });
    await insertRouteRecords(
      worker.db,
      tenantId,
      run,
      [record({ sourceId: 'sf-3', outcome: 'created', destinationId: 'd-sf-3', errorCode: null })],
      { now },
    );
    expect(
      (await dueRetries(worker.db, tenantId, ID.flowA1, now)).map((d) => d.sourceId),
    ).not.toContain('sf-3');
  });

  it('recognises its own writes coming back as an echo', async () => {
    await saveLink(worker.db, tenantId, {
      connectionId: ID.connA,
      entity: 'customer',
      sourceConnectionId: ID.connA,
      sourceId: 'sf-c1',
      destinationId: 'sf-dest-1',
    });
    const echo = await echoes(worker.db, tenantId, ID.connA, [
      { sourceId: 'sf-dest-1', changedAt: new Date().toISOString() },
      { sourceId: 'sf-other', changedAt: new Date().toISOString() },
    ]);
    expect([...echo]).toEqual(['sf-dest-1']);
  });

  it('retention removes personal data after 30 days and keeps recent rows', async () => {
    await admin(
      `insert into sync_payloads (tenant_id, run_id, entity, source_id, source_version, payload, created_at)
       values ($1, $2, 'order', 'sf-old', 'v1', '{}', now() - interval '31 days')`,
      [tenantId, ID.runA1],
    );
    const before = await admin(
      `select count(*)::int as n from sync_payloads where tenant_id = $1`,
      [tenantId],
    );
    const r = await retentionSweep(worker.db);
    expect(r.payloads).toBeGreaterThanOrEqual(1);
    const after = await admin(`select count(*)::int as n from sync_payloads where tenant_id = $1`, [
      tenantId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n - 1);
  });
});
