import { describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

/** M5: connections, the key box and the webhook path. */

const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };
const DEV_A = { tenantId: ID.tenantA, userId: ID.userADevRestricted };

describe('managing connections', () => {
  it('readers see connections but cannot add, change or remove them', async () => {
    const see = await run('web', READER_A, 'select id from connections');
    expect(see.result!.rows.map((r) => r.id)).toEqual([ID.connA]);
    const add = await run(
      'web',
      READER_A,
      `insert into connections (tenant_id, connector_id, name) values ($1, 'dinero', 'x')`,
      [ID.tenantA],
    );
    expect(add.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const upd = await run('web', READER_A, `update connections set name = 'x'`);
    expect(upd.result?.rowCount ?? 0).toBe(0);
    const del = await run('web', READER_A, 'delete from connections');
    expect(del.result?.rowCount ?? 0).toBe(0);
  });

  it('developers can add connections (PLAN: developers create connections)', async () => {
    const { error } = await run(
      'web',
      DEV_A,
      `insert into connections (tenant_id, connector_id, name) values ($1, 'dinero', 'x')`,
      [ID.tenantA],
    );
    expect(error).toBeUndefined();
  });
});

describe('webhook routes and inbound events', () => {
  it('the web role can neither read inbound payloads nor the route index', async () => {
    const events = await run('web', OWNER_A, 'select 1 from inbound_events');
    expect(events.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    for (const role of ['web', 'worker', 'support', 'ops'] as const) {
      const { error } = await run(role, OWNER_A, 'select 1 from app.webhook_routes');
      expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('ingest stores an event for a known token only, in the route owner’s tenant', async () => {
    const known = await run(
      'web',
      null,
      `select * from app.ingest_webhook($1, '{}'::jsonb, '\\x7b7d'::bytea)`,
      ['A'.repeat(43)],
    );
    expect(known.error).toBeUndefined();
    expect(known.result!.rows[0].tenant_id).toBe(ID.tenantA);
    const unknown = await run(
      'web',
      null,
      `select * from app.ingest_webhook($1, '{}'::jsonb, '\\x7b7d'::bytea)`,
      ['C'.repeat(43)],
    );
    expect(unknown.result!.rowCount).toBe(0);
  });

  it('a route can only be registered for a connection in the caller’s tenant', async () => {
    const own = await run('web', OWNER_A, `select app.register_webhook($1, $2)`, [
      'D'.repeat(43),
      ID.connA,
    ]);
    expect(own.error).toBeUndefined();
    const other = await run('web', OWNER_A, `select app.register_webhook($1, $2)`, [
      'E'.repeat(43),
      ID.connB,
    ]);
    expect(other.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('the worker reads its tenant’s events only', async () => {
    const { result } = await run(
      'worker',
      { tenantId: ID.tenantA },
      'select id from inbound_events',
    );
    expect(result!.rows.map((r) => r.id)).toEqual([ID.eventA]);
  });
});
