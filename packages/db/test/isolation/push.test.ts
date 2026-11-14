import { describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { admin, run } from './helpers.js';

/** M11 (mobile): Web Push devices are per user; the worker drains the queue across tenants. */

const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };
const SHARED_B = { tenantId: ID.tenantB, userId: ID.userShared };

describe('push subscriptions', () => {
  it('a colleague cannot see, change or remove my device', async () => {
    const seen = await run('web', READER_A, 'select endpoint from push_subscriptions');
    expect(seen.error).toBeUndefined();
    expect(seen.result!.rowCount).toBe(0);
    const upd = await run('web', READER_A, `update push_subscriptions set label = 'x'`);
    expect(upd.result?.rowCount ?? 0).toBe(0);
    const del = await run('web', READER_A, 'delete from push_subscriptions');
    expect(del.result?.rowCount ?? 0).toBe(0);
  });

  it('nobody can register a device for someone else', async () => {
    const { error } = await run(
      'web',
      READER_A,
      `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, events)
       values ($1, $2, 'https://push.example.test/x', 'k', 'a', '{}')`,
      [ID.tenantA, ID.userAOwner],
    );
    expect(error?.code).toBe('42501');
  });

  it('the owner sees exactly their own device in their own tenant', async () => {
    const { result } = await run(
      'web',
      OWNER_A,
      'select tenant_id, user_id from push_subscriptions',
    );
    expect(result!.rows).toEqual([{ tenant_id: ID.tenantA, user_id: ID.userAOwner }]);
  });

  it('a member of both tenants sees no devices of the other tenant', async () => {
    const { result } = await run(
      'web',
      SHARED_B,
      'select 1 from push_subscriptions where tenant_id = $1',
      [ID.tenantA],
    );
    expect(result!.rowCount).toBe(0);
  });

  it('the web role cannot read or drain the push queue', async () => {
    const q = await run('web', OWNER_A, 'select * from app.push_queue');
    expect(q.error?.code).toBe('42501');
    const due = await run('web', OWNER_A, `select * from app.due_pushes(now())`);
    expect(due.error?.code).toBe('42501');
  });

  it('a new notification is queued for push with ids only', async () => {
    const rows = await admin(
      'select tenant_id, user_id, kind from app.push_queue where notification_id = $1',
      [ID.noteA],
    );
    expect(rows.rows).toEqual([{ tenant_id: ID.tenantA, user_id: ID.userAOwner, kind: 'new' }]);
  });

  it('support time totals are for owners of the company only', async () => {
    const reader = await run('web', READER_A, 'select * from app.customer_support_month()');
    expect(reader.error).toBeUndefined();
    expect(reader.result!.rows[0].registered_minutes).toBe(0);
  });
});
