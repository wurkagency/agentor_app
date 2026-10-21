import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { lastWeekKey } from '@agentor/core';
import { createDatabase, notify, queueEmail } from '@agentor/db';
import { expect, test } from '@playwright/test';
import { TENANTS } from '../scripts/seed-data';
import { countTo, headersOf, latestMailTo } from './mailpit';
import { adminQuery, login, USERS } from './support';

/**
 * Designed e-mails (PLAN-EMAILS-PDF): every template in the preview, password reset and a
 * resolved case through the app to Mailpit, and the notification e-mails E19 and E22 from the
 * queue through the worker's drain (scripts/email-once.ts) to Mailpit. Fictional data only.
 */

test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);
const WORKER = resolve(process.cwd(), '../worker');

/**
 * One pass of the worker's e-mail drain, with the worker's own code and database role. Returns
 * how many it sent; the running e2e worker may have sent them first.
 */
async function drainOnce(): Promise<number> {
  const { stdout } = await run(
    process.execPath,
    [
      resolve(WORKER, 'node_modules/tsx/dist/cli.mjs'),
      '--env-file-if-exists=../../.env.local',
      'scripts/email-once.ts',
    ],
    { cwd: WORKER, timeout: 60_000 },
  );
  return (JSON.parse(stdout.trim().split('\n').pop()!) as { sent: number }).sent;
}

/** Clears the per-IP counter for /request-password-reset, as global-setup does once per run. */
async function clearResetLimit() {
  const { Redis } = await import('ioredis');
  const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  try {
    const keys = (await r.keys('agentor:rl:*')).filter((k) => k.includes('request-password-reset'));
    if (keys.length) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

function workerDb() {
  return createDatabase(process.env.DATABASE_URL_WORKER!, { max: 1 });
}

test('the preview renders every template with subject, preheader and text', async ({ page }) => {
  await page.goto('/dev/emails');
  const links = page.getByRole('navigation', { name: 'E-mails' }).getByRole('link');
  await expect(links).toHaveCount(22);
  await page.goto('/dev/emails?key=weekly-summary');
  await expect(page.getByTestId('email-subject')).toHaveText(
    'Ugen hos Nordlys Cykler: 7.639 records, 3 fejl',
  );
  await expect(page.getByTestId('email-text')).toContainText('Slå den fra: https://');
  await expect(page.locator('iframe')).toHaveCount(2);
});

test('"Glemt adgangskode?" sends E02 with a working link', async ({ page }) => {
  // Better Auth allows 3 reset requests per 5 minutes per IP; repeated runs would hit it.
  await clearResetLimit();
  const before = await countTo(USERS.sara.email, /^Nulstil din adgangskode/);
  await page.goto('/forgot-password');
  await page.getByLabel('E-mail').fill(USERS.sara.email);
  await page.getByRole('button', { name: /Send/ }).click();
  await expect.poll(() => countTo(USERS.sara.email, /^Nulstil din adgangskode/)).toBe(before + 1);
  const mail = await latestMailTo(USERS.sara.email);
  expect(mail.subject).toBe('Nulstil din adgangskode til Agentor');
  expect(mail.html).toContain('Vælg ny adgangskode');
  expect(mail.html).toContain('<meta name="color-scheme" content="light dark">');
  expect(mail.text).toContain('Linket virker i 1 time');
  expect(mail.text).toContain('Din nuværende adgangskode virker stadig.');
  const link = /Vælg ny adgangskode: (https?:\/\/\S+)/.exec(mail.text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/reset-password/);
});

test('a resolved case is mailed as E12, and a reply by e-mail reopens it', async ({ page }) => {
  const caseId = '0190b000-0000-7000-8000-00000000e012';
  await adminQuery(`delete from platform.case_events where case_id = $1`, [caseId]);
  await adminQuery(`delete from platform.cases where id = $1`, [caseId]);
  await adminQuery(
    `insert into platform.cases (id, tenant_id, title, status, priority, created_by_user_id, created_by_name)
     values ($1, $2, 'E-mail-test: kunder oprettes dobbelt', 'in_progress', 'normal', $3, $4)`,
    [caseId, TENANTS.nordlys.id, USERS.mette.id, USERS.mette.name],
  );
  await adminQuery(
    `insert into platform.case_events (case_id, tenant_id, kind, author_user_id, author_name, body)
     values ($1, $2, 'customer_message', $3, $4, 'Kunderne oprettes to gange i Dinero.'),
            ($1, $2, 'internal_note', null, 'Anne Sørensen', 'INTERN: tjek mappingen før vi svarer')`,
    [caseId, TENANTS.nordlys.id, USERS.mette.id, USERS.mette.name],
  );
  try {
    const before = await countTo(USERS.mette.email, /^Løst: E-mail-test/);
    await login(page, 'anne');
    await page.goto(`/platform/support/cases/${caseId}/resolve`);
    await page
      .getByLabel('Afsluttende besked')
      .filter({ visible: true })
      .fill('Hej {name}. Kunderne oprettes nu kun én gang. Skriv, hvis det sker igen.');
    await page.getByRole('button', { name: 'Løs og send' }).filter({ visible: true }).click();
    await expect.poll(() => countTo(USERS.mette.email, /^Løst: E-mail-test/)).toBe(before + 1);
    const mail = await latestMailTo(USERS.mette.email);
    expect(mail.subject).toMatch(/^Løst: E-mail-test: kunder oprettes dobbelt \(sag #\d+\)$/);
    expect(mail.html).toContain('Din sag er løst');
    expect(mail.text).toContain('Hej Mette. Kunderne oprettes nu kun én gang.');
    expect(mail.text).toContain('Kunderne oprettes to gange i Dinero.');
    // Internal notes never leave Agentor.
    expect(mail.text).not.toContain('INTERN');
    expect(mail.html).not.toContain('INTERN');
    // Without CASE_REPLY_DOMAIN replies go to support; with it, to the case's own address.
    expect(mail.replyTo[0]).toMatch(/^(support@agentor\.dk|sag\+[0-9a-f]{32}@.+)$/);
    const headers = await headersOf(mail.id);
    expect(headers['X-Entity-Ref-Id']?.[0] ?? headers['X-Entity-Ref-ID']?.[0]).toBe(
      `case-${caseId}`,
    );

    // The reply arrives through agentor-ingest (/mail/inbound) as app.case_reply_by_email.
    const token = '0123456789abcdef0123456789abcdef';
    await adminQuery(`update platform.cases set reply_token = $2 where id = $1`, [caseId, token]);
    const [r] = await adminQuery<{ r: string }>(
      `select app.case_reply_by_email($1, $2, 'Nu sker det igen for ordre #10511.') as r`,
      [token, USERS.mette.email],
    );
    expect(r!.r).toBe('reopened');
    await page.goto(`/platform/support/cases/${caseId}`);
    await expect(page.getByText('Nu sker det igen for ordre #10511.').first()).toBeVisible();
    const [c] = await adminQuery<{ status: string }>(
      `select status from platform.cases where id = $1`,
      [caseId],
    );
    expect(c!.status).toBe('in_progress');
  } finally {
    await adminQuery(`delete from audit_log where object_id = $1`, [caseId]);
    await adminQuery(`delete from platform.time_entries where case_id = $1`, [caseId]);
    await adminQuery(`delete from platform.case_events where case_id = $1`, [caseId]);
    await adminQuery(`delete from platform.cases where id = $1`, [caseId]);
  }
});

test('E19 goes to members with e-mail on for "Forbindelse afbrudt", not to the others', async () => {
  const conn = '0190b000-0000-7000-8000-000000000302';
  const [prev] = await adminQuery<{
    status: string;
    broken_since: Date | null;
    status_reason: string | null;
  }>(`select status, broken_since, status_reason from connections where id = $1`, [conn]);
  const subject = /er afbrudt · Outlet → regnskab står stille$/;
  const metteBefore = await countTo(USERS.mette.email, subject);
  const jonasBefore = await countTo(USERS.jonas.email, subject);
  await adminQuery(
    `delete from notification_prefs where tenant_id = $1 and user_id in ($2, $3) and event = 'connection_broken'`,
    [TENANTS.nordlys.id, USERS.mette.id, USERS.jonas.id],
  );
  // Jonas turned e-mail off for this event; Mette keeps the default (on).
  await adminQuery(
    `insert into notification_prefs (tenant_id, user_id, event, in_app, email, push, sms)
     values ($1, $2, 'connection_broken', true, false, false, false)`,
    [TENANTS.nordlys.id, USERS.jonas.id],
  );
  await adminQuery(
    `update notifications set resolved_at = now() where connection_id = $1 and resolved_at is null`,
    [conn],
  );
  await adminQuery(
    `update connections set status = 'broken', broken_since = now() - interval '1 hour',
       status_reason = 'Adgangen blev afvist. Log ind igen for at give Agentor adgang.' where id = $1`,
    [conn],
  );
  const db = workerDb();
  try {
    // What agentor-worker does when a connection test fails (connections.ts testConnection).
    await notify(db.db, TENANTS.nordlys.id, {
      event: 'connection_broken',
      messageKey: 'connectionBroken',
      params: { connector: 'e-conomic', name: 'Nordlys Outlet' },
      href: `/connections/${conn}`,
      needsAction: true,
      connectionId: conn,
    });
    // The e2e worker (playwright.config webServer) drains every 5 s; this pass makes it
    // independent of that timing. Either way the e-mail must reach Mailpit exactly once.
    await drainOnce();
    await expect.poll(() => countTo(USERS.mette.email, subject)).toBe(metteBefore + 1);
    expect(await countTo(USERS.jonas.email, subject)).toBe(jonasBefore);
    const mail = await latestMailTo(USERS.mette.email);
    expect(mail.text).toMatch(/^Genforbind \S+: https?:\/\//m);
    expect(mail.text).toContain('Venter i kø:');
    expect(mail.text).toContain(`/connections/${conn}/reconnect`);
    expect(mail.text).toContain('Ret notifikationer: http');
  } finally {
    await db.close();
    await adminQuery(
      `update notifications set resolved_at = now() where connection_id = $1 and resolved_at is null`,
      [conn],
    );
    await adminQuery(
      `update connections set status = $2, broken_since = $3, status_reason = $4 where id = $1`,
      [conn, prev!.status, prev!.broken_since, prev!.status_reason],
    );
    await adminQuery(
      `delete from notification_prefs where tenant_id = $1 and user_id = $2 and event = 'connection_broken'`,
      [TENANTS.nordlys.id, USERS.jonas.id],
    );
  }
});

test('E22 goes only to members who opted in, and unsubscribe works', async ({ page, request }) => {
  const key = lastWeekKey(new Date());
  const subject = /^Ugen hos Nordlys Cykler: /;
  const clean = async () => {
    await adminQuery(
      `delete from app.email_queue where tenant_id = $1 and event = 'weekly_summary'`,
      [TENANTS.nordlys.id],
    );
    await adminQuery(
      `delete from notification_prefs where tenant_id = $1 and event = 'weekly_summary' and user_id in ($2, $3)`,
      [TENANTS.nordlys.id, USERS.mette.id, USERS.jonas.id],
    );
  };
  await clean();
  // E22 respects quiet hours (default 22–07); the test may run at night, so they are off here.
  const [quiet] = await adminQuery<{ quiet_enabled: boolean }>(
    `select quiet_enabled from notification_settings where tenant_id = $1 and user_id = $2`,
    [TENANTS.nordlys.id, USERS.mette.id],
  );
  await adminQuery(
    `insert into notification_settings (tenant_id, user_id, quiet_enabled) values ($1, $2, false)
     on conflict (tenant_id, user_id) do update set quiet_enabled = false`,
    [TENANTS.nordlys.id, USERS.mette.id],
  );
  const metteBefore = await countTo(USERS.mette.email, subject);
  const jonasBefore = await countTo(USERS.jonas.email, subject);
  await adminQuery(
    `insert into notification_prefs (tenant_id, user_id, event, in_app, email, push, sms)
     values ($1, $2, 'weekly_summary', false, true, false, false)`,
    [TENANTS.nordlys.id, USERS.mette.id],
  );
  const db = workerDb();
  try {
    // What the scheduler does on Monday at 08:00 (weekly.ts): everyone opted in, nobody else.
    const recipients = await adminQuery<{ tenant_id: string; user_id: string }>(
      `select * from app.weekly_summary_recipients() where tenant_id = $1`,
      [TENANTS.nordlys.id],
    );
    expect(recipients.map((r) => r.user_id)).toEqual([USERS.mette.id]);
    for (const r of recipients)
      await queueEmail(db.db, r.tenant_id, { userId: r.user_id, event: 'weekly_summary', key });
    // The e2e worker (playwright.config webServer) drains every 5 s; this pass makes it
    // independent of that timing. Either way the e-mail must reach Mailpit exactly once.
    await drainOnce();
    await expect.poll(() => countTo(USERS.mette.email, subject)).toBe(metteBefore + 1);
    expect(await countTo(USERS.jonas.email, subject)).toBe(jonasBefore);

    const mail = await latestMailTo(USERS.mette.email);
    const headers = await headersOf(mail.id);
    const listUnsubscribe = headers['List-Unsubscribe']?.[0] ?? '';
    expect(listUnsubscribe).toMatch(/^<https?:\/\/\S+\/api\/unsubscribe\/[A-Za-z0-9_-]{32,}>$/);
    expect(headers['List-Unsubscribe-Post']?.[0]).toBe('List-Unsubscribe=One-Click');

    const link = /Slå den fra: (https?:\/\/\S+)/.exec(mail.text)![1]!;
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Afmeld ugentlig opsummering' })).toBeVisible();
    await page.getByRole('button', { name: 'Afmeld' }).click();
    await expect(page.getByText('Du er afmeldt.')).toBeVisible();
    const [pref] = await adminQuery<{ email: boolean }>(
      `select email from notification_prefs where tenant_id = $1 and user_id = $2 and event = 'weekly_summary'`,
      [TENANTS.nordlys.id, USERS.mette.id],
    );
    expect(pref!.email).toBe(false);
    // One-click from the mail client: no cookies, always a plain 200.
    const oneClick = await request.post(listUnsubscribe.slice(1, -1), {
      form: { 'List-Unsubscribe': 'One-Click' },
    });
    expect(oneClick.status()).toBe(200);
  } finally {
    await db.close();
    await clean();
    if (quiet)
      await adminQuery(
        `update notification_settings set quiet_enabled = $3 where tenant_id = $1 and user_id = $2`,
        [TENANTS.nordlys.id, USERS.mette.id, quiet.quiet_enabled],
      );
    else
      await adminQuery(`delete from notification_settings where tenant_id = $1 and user_id = $2`, [
        TENANTS.nordlys.id,
        USERS.mette.id,
      ]);
    await adminQuery(
      `delete from audit_log where tenant_id = $1 and action = 'notifications.unsubscribed'`,
      [TENANTS.nordlys.id],
    );
  }
});
