import { describe, expect, it } from 'vitest';
import { ID } from './fixtures.js';
import { INSUFFICIENT_PRIVILEGE, run } from './helpers.js';

/** M3: team management, invitations, per-user settings, audit visibility and break-glass. */

const OWNER_A = { tenantId: ID.tenantA, userId: ID.userAOwner };
const READER_A = { tenantId: ID.tenantA, userId: ID.userAReader };
const DEV_A = { tenantId: ID.tenantA, userId: ID.userADevRestricted };
const SHARED_A = { tenantId: ID.tenantA, userId: ID.userShared }; // developer, all flows
const SHARED_B = { tenantId: ID.tenantB, userId: ID.userShared }; // admin in B

describe('team changes are for owners and admins only', () => {
  it('a reader or developer cannot change roles or remove members', async () => {
    for (const ctx of [READER_A, DEV_A, SHARED_A]) {
      const upd = await run('web', ctx, `update memberships set role = 'admin' where id = $1`, [
        ID.memAReader,
      ]);
      expect(upd.error?.code ?? (upd.result!.rowCount === 0 ? 'none' : 'changed')).not.toBe(
        'changed',
      );
      const del = await run('web', ctx, 'delete from memberships where id = $1', [ID.memAReader]);
      expect(del.error?.code ?? (del.result!.rowCount === 0 ? 'none' : 'deleted')).not.toBe(
        'deleted',
      );
    }
  });

  it('an owner can change a member role', async () => {
    const { result, error } = await run(
      'web',
      OWNER_A,
      `update memberships set role = 'admin' where id = $1`,
      [ID.memAReader],
    );
    expect(error).toBeUndefined();
    expect(result!.rowCount).toBe(1);
  });

  it('an admin cannot demote an owner or make someone owner', async () => {
    const demote = await run(
      'web',
      SHARED_B,
      `update memberships set role = 'admin' where id = $1`,
      [ID.memBOwner],
    );
    expect(demote.result?.rowCount ?? 0).toBe(0);
    const promote = await run(
      'web',
      SHARED_B,
      `update memberships set role = 'owner' where id = $1`,
      [ID.memBShared],
    );
    expect(promote.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('only owners and admins can change company settings', async () => {
    const reader = await run('web', READER_A, `update tenants set name = 'x' where id = $1`, [
      ID.tenantA,
    ]);
    expect(reader.result!.rowCount).toBe(0);
    const owner = await run(
      'web',
      OWNER_A,
      `update tenants set name = 'Tenant A ApS' where id = $1`,
      [ID.tenantA],
    );
    expect(owner.result!.rowCount).toBe(1);
  });

  it('new tenants cannot be inserted by runtime roles', async () => {
    for (const role of ['web', 'worker'] as const) {
      const { error } = await run(
        role,
        OWNER_A,
        `insert into tenants (id, name) values ($1, 'x')`,
        [ID.tenantA],
      );
      expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe('invitations', () => {
  it('are visible to admins only', async () => {
    const owner = await run('web', OWNER_A, 'select id from invitations');
    expect(owner.result!.rows.map((r) => r.id)).toEqual([ID.inviteA]);
    const reader = await run('web', READER_A, 'select id from invitations');
    expect(reader.result!.rowCount).toBe(0);
  });

  it('the token index is not readable by any runtime role', async () => {
    for (const role of ['web', 'worker', 'support', 'ops'] as const) {
      const { error } = await run(role, OWNER_A, 'select * from app.invitation_tokens');
      expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('preview shows only the invited tenant, and nothing for an unknown token', async () => {
    const ok = await run('web', null, `select * from app.invitation_preview('hash-a')`);
    expect(ok.result!.rows).toEqual([
      { tenant_name: 'Tenant A', email: 'invitee-a@example.test', role: 'reader', state: 'open' },
    ]);
    const none = await run('web', null, `select * from app.invitation_preview('no-such-hash')`);
    expect(none.result!.rowCount).toBe(0);
  });

  it('accepting creates a membership for the signed-in, invited user', async () => {
    const { result, error } = await run(
      'web',
      { userId: ID.userInviteeA },
      `select app.accept_invitation('hash-a') as t`,
    );
    expect(error).toBeUndefined();
    expect(result!.rows[0].t).toBe(ID.tenantA);
  });

  it('a different user cannot accept someone else’s invitation', async () => {
    const { error } = await run(
      'web',
      { userId: ID.userBOwner },
      `select app.accept_invitation('hash-a')`,
    );
    expect(error?.message).toContain('INVITATION_EMAIL_MISMATCH');
  });

  it('accepting requires a signed-in user', async () => {
    const { error } = await run('web', null, `select app.accept_invitation('hash-a')`);
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('personal notification settings', () => {
  it('each user sees and changes only their own', async () => {
    const reader = await run('web', READER_A, 'select * from notification_prefs');
    expect(reader.result!.rowCount).toBe(0);
    const forOther = await run(
      'web',
      READER_A,
      `insert into notification_prefs (tenant_id, user_id, event) values ($1, $2, 'quota')`,
      [ID.tenantA, ID.userAOwner],
    );
    expect(forOther.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const own = await run(
      'web',
      READER_A,
      `insert into notification_prefs (tenant_id, user_id, event) values ($1, $2, 'quota')`,
      [ID.tenantA, ID.userAReader],
    );
    expect(own.error).toBeUndefined();
  });
});

describe('audit log visibility', () => {
  it('members can append, but only owners and admins can read', async () => {
    const append = await run(
      'web',
      READER_A,
      `insert into audit_log (tenant_id, actor_kind, action, object_type) values ($1, 'user', 'x', 'y')`,
      [ID.tenantA],
    );
    expect(append.error).toBeUndefined();
    const read = await run('web', READER_A, 'select 1 from audit_log');
    expect(read.result!.rowCount).toBe(0);
    const ownerRead = await run('web', OWNER_A, 'select 1 from audit_log');
    expect(ownerRead.result!.rowCount).toBeGreaterThan(0);
  });
});

describe('break-glass support access', () => {
  it('support can request access through the audited function only', async () => {
    const { result, error } = await run(
      'support',
      null,
      `select app.support_request_access($1, 'Anne · Agentor', '#2291', 'Kreditnotaer fejler', 2) as id`,
      [ID.tenantA],
    );
    expect(error).toBeUndefined();
    expect(result!.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('access is capped at 24 hours and needs a case and a reason', async () => {
    const tooLong = await run(
      'support',
      null,
      `select app.support_request_access($1, 'Anne', '#1', 'x', 25)`,
      [ID.tenantA],
    );
    expect(tooLong.error?.message).toContain('SUPPORT_HOURS_OUT_OF_RANGE');
    const noReason = await run(
      'support',
      null,
      `select app.support_request_access($1, 'Anne', '#1', ' ', 2)`,
      [ID.tenantA],
    );
    expect(noReason.error?.message).toContain('SUPPORT_CASE_AND_REASON_REQUIRED');
  });

  it('web and worker cannot open support access; support cannot accept invitations', async () => {
    for (const role of ['web', 'worker'] as const) {
      const { error } = await run(
        role,
        OWNER_A,
        `select app.support_request_access($1, 'x', '#1', 'x', 1)`,
        [ID.tenantA],
      );
      expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const { error } = await run(
      'support',
      { userId: ID.userInviteeA },
      `select app.accept_invitation('hash-a')`,
    );
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
