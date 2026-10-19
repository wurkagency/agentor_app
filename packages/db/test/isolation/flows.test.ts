import { describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

/** M6: flows, versions, runs and notifications. */

const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };
const DEV_A = { tenantId: ID.tenantA, userId: ID.userADevRestricted };

describe('per-flow access reaches versions, runs and records', () => {
  it('a restricted developer sees only the granted flow everywhere', async () => {
    for (const [table, expected] of [
      ['flow_versions', [ID.versionA1, ID.draftA1]],
      ['runs', [ID.runA1]],
      ['run_records', [ID.recordA1]],
    ] as const) {
      const { result } = await run('web', DEV_A, `select id from ${table} order by id`);
      expect(
        result!.rows.map((r) => r.id),
        table,
      ).toEqual(expected);
    }
  });

  it('owners see all of their tenant and nothing of the other', async () => {
    const { result } = await run('web', OWNER_A, 'select id from runs order by id');
    expect(result!.rows.map((r) => r.id)).toEqual([ID.runA1, ID.runA2]);
  });
});

describe('readers change nothing', () => {
  it('cannot create or edit flows, drafts or runs', async () => {
    const flow = await run(
      'web',
      READER_A,
      `insert into flows (tenant_id, name) values ($1, 'x')`,
      [ID.tenantA],
    );
    expect(flow.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const upd = await run('web', READER_A, `update flows set name = 'x'`);
    expect(upd.result?.rowCount ?? 0).toBe(0);
    const draft = await run(
      'web',
      READER_A,
      `insert into flow_versions (tenant_id, flow_id, state, definition) values ($1, $2, 'draft', '{}')`,
      [ID.tenantA, ID.flowA1],
    );
    expect(draft.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const r = await run(
      'web',
      READER_A,
      `insert into runs (tenant_id, flow_id, version_id, kind, status) values ($1, $2, $3, 'manual', 'queued')`,
      [ID.tenantA, ID.flowA1, ID.versionA1],
    );
    expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('published versions are immutable', () => {
  it('an owner cannot change or delete a published version', async () => {
    const upd = await run(
      'web',
      OWNER_A,
      `update flow_versions set definition = '{"x":1}' where id = $1`,
      [ID.versionA1],
    );
    expect(upd.result?.rowCount ?? 0).toBe(0);
    const del = await run('web', OWNER_A, 'delete from flow_versions where id = $1', [
      ID.versionA1,
    ]);
    expect(del.result?.rowCount ?? 0).toBe(0);
  });

  it('only one draft per flow', async () => {
    const { error } = await run(
      'web',
      OWNER_A,
      `insert into flow_versions (tenant_id, flow_id, state, definition) values ($1, $2, 'draft', '{}')`,
      [ID.tenantA, ID.flowA1],
    );
    expect(error?.code).toBe('23505');
  });
});

describe('records, links and notifications', () => {
  it('the web role cannot write run records or read the cross-reference', async () => {
    const w = await run('web', OWNER_A, `update run_records set outcome = 'created'`);
    expect(w.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const l = await run('web', OWNER_A, 'select 1 from record_links');
    expect(l.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('each user sees only their own notifications and can only mark them read', async () => {
    const own = await run('web', OWNER_A, 'select id from notifications');
    expect(own.result!.rows.map((r) => r.id)).toEqual([ID.noteA]);
    const other = await run('web', READER_A, 'select id from notifications');
    expect(other.result!.rowCount).toBe(0);
    const read = await run('web', OWNER_A, 'update notifications set read_at = now()');
    expect(read.result!.rowCount).toBe(1);
    const forge = await run('web', OWNER_A, `update notifications set message_key = 'x'`);
    expect(forge.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('publishing a draft (app.publish_flow_version)', () => {
  const publish = (ctx: { tenantId: string; userId: string }, flowId: string, draftId: string) =>
    run('web', ctx, `select app.publish_flow_version($1, $2, '[]'::jsonb, 'Test') as n`, [
      flowId,
      draftId,
    ]);

  it('promotes the draft to the next version and archives the previous one', async () => {
    const { result, error } = await publish(OWNER_A, ID.flowA1, ID.draftA1);
    expect(error).toBeUndefined();
    expect(result!.rows[0].n).toBe(2);
  });

  it('readers, other tenants and users without access to the flow cannot publish', async () => {
    expect((await publish(READER_A, ID.flowA1, ID.draftA1)).error?.code).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect((await publish(DEV_A, ID.flowA2, ID.draftA1)).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const otherTenant = await publish(
      { tenantId: ID.tenantB, userId: ID.userBOwner },
      ID.flowB1,
      ID.draftA1,
    );
    expect(otherTenant.error?.message).toContain('DRAFT_NOT_FOUND');
  });

  it('only the web role may call it', async () => {
    const { error } = await run(
      'worker',
      OWNER_A,
      `select app.publish_flow_version($1, $2, '[]'::jsonb, 'x')`,
      [ID.flowA1, ID.draftA1],
    );
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
