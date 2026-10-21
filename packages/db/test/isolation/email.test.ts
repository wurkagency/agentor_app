import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import { notify } from '../../src/repo/engine.js';
import {
  caseReplyByEmail,
  dueEmails,
  emailRecipient,
  emailSent,
  queueEmail,
  unsubscribeApply,
  unsubscribeInfo,
  unsubscribeToken,
  weeklyRecipients,
} from '../../src/repo/email.js';
import { roleUrl } from './env.js';
import { ID } from './fixtures.js';
import { admin, run } from './helpers.js';

/**
 * E-mails (PLAN-EMAILS-PDF §5): the notification e-mail queue follows each member's choice and
 * is idempotent; only the worker can read it; unsubscribe and case replies work by token only,
 * for the right company.
 */

let worker: DatabaseHandle;
let web: DatabaseHandle;
const CASE = '0190a000-0000-7000-8000-0000000ae001';
const CASE_OLD = '0190a000-0000-7000-8000-0000000ae002';
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const TOKEN_OLD = 'ffffeeeeddddccccbbbbaaaa99998888';

beforeAll(async () => {
  const db = inject('isolationDb');
  worker = createDatabase(roleUrl('worker', db), { max: 2 });
  web = createDatabase(roleUrl('web', db), { max: 2 });
  await admin(
    `insert into notification_prefs (tenant_id, user_id, event, in_app, email, push, sms)
     values ($1, $2, 'connection_broken', true, false, false, false)`,
    [ID.tenantA, ID.userAReader],
  );
  await admin(
    `insert into platform.cases (id, tenant_id, title, status, created_by_name, resolved_at, reply_token)
     values ($1, $3, 'Fakturaer fejler', 'resolved', 'Owner A', now() - interval '1 day', $4),
            ($2, $3, 'Gammel sag', 'resolved', 'Owner A', now() - interval '15 days', $5)`,
    [CASE, CASE_OLD, ID.tenantA, TOKEN, TOKEN_OLD],
  );
});

afterAll(async () => {
  await admin(`delete from platform.case_events where case_id in ($1, $2)`, [CASE, CASE_OLD]);
  await admin(`delete from platform.cases where id in ($1, $2)`, [CASE, CASE_OLD]);
  await admin(
    `delete from audit_log where action in ('case.replied_by_email', 'notifications.unsubscribed')`,
  );
  await admin(`delete from app.email_queue`);
  await admin(`delete from app.unsubscribe_tokens`);
  await admin(`delete from notifications where message_key = 'connectionBroken'`);
  await admin(
    `delete from notification_prefs where tenant_id = $1 and ((user_id = $2 and event = 'connection_broken') or (user_id = $3 and event = 'weekly_summary'))`,
    [ID.tenantA, ID.userAReader, ID.userAOwner],
  );
  await worker?.close();
  await web?.close();
});

describe('notification e-mail queue (E19–E21)', () => {
  it('queues one e-mail per member with e-mail on, and none twice for the same problem', async () => {
    const n = {
      event: 'connection_broken' as const,
      messageKey: 'connectionBroken',
      params: { connector: 'e-conomic', name: 'Nordlys Outlet' },
      href: `/connections/${ID.connA}`,
      needsAction: true,
      connectionId: ID.connA,
    };
    await notify(worker.db, ID.tenantA, n);
    await notify(worker.db, ID.tenantA, n);
    const due = (await dueEmails(worker.db)).filter((d) => d.tenantId === ID.tenantA);
    const users = due.filter((d) => d.event === 'connection_broken').map((d) => d.userId);
    // Owner, restricted developer and the shared member; the reader switched e-mail off.
    expect(users.sort()).toEqual([ID.userAOwner, ID.userADevRestricted, ID.userShared].sort());
    expect(due.every((d) => d.notificationId)).toBe(true);
  });

  it('keys E21 by month: the same month is never queued twice', async () => {
    expect(
      await queueEmail(worker.db, ID.tenantA, {
        userId: ID.userAOwner,
        event: 'quota',
        key: 'quota:2026-10',
      }),
    ).toBe(true);
    expect(
      await queueEmail(worker.db, ID.tenantA, {
        userId: ID.userAOwner,
        event: 'quota',
        key: 'quota:2026-10',
      }),
    ).toBe(false);
  });

  it('a sent e-mail is not due again', async () => {
    const [first] = await dueEmails(worker.db);
    await emailSent(worker.db, first!.id, '<m1@test>');
    expect((await dueEmails(worker.db)).some((d) => d.id === first!.id)).toBe(false);
  });

  it('cannot queue for another company than the current one', async () => {
    const { error } = await run(
      'worker',
      { tenantId: ID.tenantB },
      `select app.queue_email($1, $2, 'quota', 'quota:2026-11', null, null)`,
      [ID.tenantA, ID.userAOwner],
    );
    expect(error?.message).toMatch(/TENANT_MISMATCH/);
  });

  it('the web role can neither read the queue nor drain it', async () => {
    const q = await run(
      'web',
      { tenantId: ID.tenantA, userId: ID.userAOwner },
      'select * from app.email_queue',
    );
    expect(q.error?.code).toBe('42501');
    const due = await run(
      'web',
      { tenantId: ID.tenantA, userId: ID.userAOwner },
      'select * from app.due_emails(now())',
    );
    expect(due.error?.code).toBe('42501');
  });
});

describe('recipient lookup', () => {
  it("gives the worker a member's address, and nothing for a non-member", async () => {
    const base = {
      tenantId: ID.tenantA,
      event: 'connection_broken' as const,
      notificationId: null,
    };
    const me = await emailRecipient(worker.db, { ...base, userId: ID.userAReader });
    expect(me).toMatchObject({ email: 'reader-a@example.test', name: 'Reader A', emailOn: false });
    expect(await emailRecipient(worker.db, { ...base, userId: ID.userBOwner })).toBeNull();
  });

  it('refuses another company than the current one', async () => {
    const { error } = await run(
      'worker',
      { tenantId: ID.tenantB },
      'select * from app.email_recipient($1, $2)',
      [ID.tenantA, ID.userAOwner],
    );
    expect(error?.message).toMatch(/TENANT_MISMATCH/);
  });
});

describe('weekly summary opt-in and unsubscribe (E22)', () => {
  it('lists only members who switched it on', async () => {
    expect((await weeklyRecipients(worker.db)).filter((r) => r.tenantId === ID.tenantA)).toEqual(
      [],
    );
    await admin(
      `insert into notification_prefs (tenant_id, user_id, event, in_app, email, push, sms)
       values ($1, $2, 'weekly_summary', false, true, false, false)`,
      [ID.tenantA, ID.userAOwner],
    );
    expect(await weeklyRecipients(worker.db)).toContainEqual({
      tenantId: ID.tenantA,
      userId: ID.userAOwner,
    });
  });

  it('unsubscribes by token without a login and writes the audit log', async () => {
    const token = await unsubscribeToken(worker.db, ID.tenantA, ID.userAOwner, 'x'.repeat(32));
    // The first token stays; a second call returns it rather than a new one.
    expect(await unsubscribeToken(worker.db, ID.tenantA, ID.userAOwner, 'y'.repeat(32))).toBe(
      token,
    );
    expect(await unsubscribeInfo(web.db, token)).toEqual({
      tenantName: expect.any(String),
      event: 'weekly_summary',
      active: true,
    });
    expect(await unsubscribeApply(web.db, token)).toBe(true);
    expect((await unsubscribeInfo(web.db, token))?.active).toBe(false);
    const prefs = await admin(
      `select email from notification_prefs where tenant_id = $1 and user_id = $2 and event = 'weekly_summary'`,
      [ID.tenantA, ID.userAOwner],
    );
    expect(prefs.rows).toEqual([{ email: false }]);
    expect(
      (await weeklyRecipients(worker.db)).some(
        (r) => r.tenantId === ID.tenantA && r.userId === ID.userAOwner,
      ),
    ).toBe(false);
    const audit = await admin(
      `select actor_user_id from audit_log where tenant_id = $1 and action = 'notifications.unsubscribed'`,
      [ID.tenantA],
    );
    expect(audit.rows).toEqual([{ actor_user_id: ID.userAOwner }]);
  });

  it('a made-up token does nothing', async () => {
    expect(await unsubscribeInfo(web.db, 'z'.repeat(40))).toBeNull();
    expect(await unsubscribeApply(web.db, 'z'.repeat(40))).toBe(false);
    expect(await unsubscribeApply(web.db, "'; drop table x; --")).toBe(false);
  });

  it('the worker cannot create a token in another company', async () => {
    const { error } = await run(
      'worker',
      { tenantId: ID.tenantB },
      `select app.unsubscribe_token($1, $2, 'weekly_summary', $3)`,
      [ID.tenantA, ID.userAOwner, 'w'.repeat(32)],
    );
    expect(error?.message).toMatch(/TENANT_MISMATCH/);
  });
});

describe('replies to a resolved case by e-mail (E12)', () => {
  it('ignores unknown tokens and people outside the company', async () => {
    expect(await caseReplyByEmail(web.db, 'nope'.repeat(6), 'owner-a@example.test', 'Hej')).toBe(
      'unknown',
    );
    expect(await caseReplyByEmail(web.db, TOKEN, 'owner-b@example.test', 'Hej')).toBe('not_member');
    const events = await admin(`select 1 from platform.case_events where case_id = $1`, [CASE]);
    expect(events.rowCount).toBe(0);
  });

  it('a bare "Ja" answers the satisfaction question without reopening', async () => {
    expect(await caseReplyByEmail(web.db, TOKEN, 'Owner-A@example.test', 'Ja!')).toBe(
      'satisfaction',
    );
    const c = await admin(`select status, satisfied from platform.cases where id = $1`, [CASE]);
    expect(c.rows).toEqual([{ status: 'resolved', satisfied: true }]);
  });

  it('a reply from a member reopens the case within 14 days', async () => {
    expect(await caseReplyByEmail(web.db, TOKEN, 'owner-a@example.test', 'Det fejler igen.')).toBe(
      'reopened',
    );
    const c = await admin(`select status from platform.cases where id = $1`, [CASE]);
    expect(c.rows).toEqual([{ status: 'in_progress' }]);
    const e = await admin(
      `select kind, author_user_id, body from platform.case_events where case_id = $1 and kind = 'customer_message'`,
      [CASE],
    );
    expect(e.rows).toEqual([
      { kind: 'customer_message', author_user_id: ID.userAOwner, body: 'Det fejler igen.' },
    ]);
  });

  it('an archived case (resolved more than 14 days ago) is not reopened', async () => {
    expect(await caseReplyByEmail(web.db, TOKEN_OLD, 'owner-a@example.test', 'Hej igen')).toBe(
      'archived',
    );
    const c = await admin(`select status from platform.cases where id = $1`, [CASE_OLD]);
    expect(c.rows).toEqual([{ status: 'resolved' }]);
  });
});
