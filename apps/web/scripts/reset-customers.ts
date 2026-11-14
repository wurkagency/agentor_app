/**
 * Clears every customer and every login except one Super Administrator, so customers can be
 * created again from Platform. Removes:
 *   - every company (tenant) and everything that belongs to it: memberships, flows, connections,
 *     keys, invitations, subscriptions, invoices, cases, notes, support time and its audit log
 *     (all references cascade); the saved card at QuickPay is cancelled first
 *   - every other login (auth.users with sessions, passkeys, two-step login and profiles) and
 *     their profile photos in the storage area
 *   - every other staff member, so the kept user is the only Super Administrator
 * Kept: the plans and price versions, platform settings, incidents and the platform audit log.
 *
 * Shows what it would remove and stops, unless RESET_CONFIRM is the kept e-mail, and then asks
 * once more. Run on the server as root:
 *
 *   agentor-reset-customers charlie@wurk.dk            (dry run)
 *   agentor-reset-customers charlie@wurk.dk --delete   (asks, then deletes)
 */
import { createInterface } from 'node:readline';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createQuickPay, QuickPayError } from '@agentor/billing';
import pg from 'pg';
import { z } from 'zod';

const input = z
  .object({
    RESET_KEEP_EMAIL: z.email(),
    RESET_DELETE: z.enum(['0', '1']).default('0'),
    DATABASE_URL_OWNER: z.string().min(1),
    QUICKPAY_MODE: z.string().optional(),
    QUICKPAY_API_KEY: z.string().optional(),
    APP_URL: z.string().optional(),
    STORAGE_DIR: z.string().optional(),
  })
  .safeParse(process.env);
if (!input.success) {
  console.error(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const env = input.data;
const keep = env.RESET_KEEP_EMAIL.toLowerCase();
const doDelete = env.RESET_DELETE === '1';

const db = new pg.Client({ connectionString: env.DATABASE_URL_OWNER });
await db.connect();

try {
  const [kept] = (
    await db.query<{ id: string; name: string; role: string | null }>(
      `select u.id, u.name, s.role from auth.users u left join platform.staff s on s.user_id = u.id
        where lower(u.email) = $1`,
      [keep],
    )
  ).rows;
  if (!kept) throw new Error(`No login with the e-mail ${keep}. Nothing was changed.`);
  if (kept.role !== 'superadmin')
    throw new Error(
      `${keep} is not a Super Administrator. Run agentor-superadmin for it first. Nothing was changed.`,
    );

  // Companies, read one at a time: tenants has forced row-level security.
  const ids = (await db.query<{ tenant_id: string }>(`select tenant_id from app.tenant_directory`))
    .rows;
  const tenants: { id: string; name: string; invoices: number; sub: string | null }[] = [];
  for (const { tenant_id: id } of ids) {
    await db.query('begin');
    await db.query(`select set_config('app.tenant_id', $1, true)`, [id]);
    const [t] = (
      await db.query<{ name: string; invoices: number; sub: string | null }>(
        `select t.name,
                (select count(*)::int from invoices i where i.tenant_id = t.id and i.number is not null) as invoices,
                (select s.provider_subscription_id from subscriptions s where s.tenant_id = t.id limit 1) as sub
           from tenants t where t.id = $1`,
        [id],
      )
    ).rows;
    await db.query('commit');
    if (t) tenants.push({ id, ...t });
  }
  const users = (
    await db.query<{ id: string; email: string }>(
      `select id, email from auth.users where id <> $1 order by email`,
      [kept.id],
    )
  ).rows;
  const staff = (
    await db.query<{ user_id: string }>(`select user_id from platform.staff where user_id <> $1`, [
      kept.id,
    ])
  ).rows;

  console.log(`Kept: ${keep} (${kept.name}), Super Administrator.`);
  console.log(`\nCompanies to delete: ${tenants.length}`);
  for (const t of tenants)
    console.log(
      `  - ${t.name}${t.invoices ? ` · ${t.invoices} issued invoice(s)` : ''}${t.sub ? ' · card at QuickPay' : ''}`,
    );
  console.log(`\nLogins to delete: ${users.length}`);
  for (const u of users) console.log(`  - ${u.email}`);
  console.log(`\nStaff roles to remove: ${staff.length}`);
  const invoiced = tenants.filter((t) => t.invoices > 0);
  if (invoiced.length)
    console.log(
      `\nNote: ${invoiced.length} company/companies have issued invoices. If any of them is a real ` +
        'customer, the invoices must be kept for 5 years (bogføringsloven); export them first.',
    );

  if (!doDelete) {
    console.log('\nDry run: nothing was changed. Add --delete to delete the above.');
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((r) =>
    rl.question(`\nType ${keep} to delete all of the above: `, (a) => {
      rl.close();
      r(a);
    }),
  );
  if (answer.trim().toLowerCase() !== keep) {
    console.log('Not confirmed. Nothing was changed.');
    process.exit(1);
  }

  // Saved cards first, as the signup purge does; a company whose card can't be cancelled stays.
  const qp = createQuickPay({
    QUICKPAY_MODE: env.QUICKPAY_MODE,
    QUICKPAY_API_KEY: env.QUICKPAY_API_KEY,
    APP_URL: env.APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  let deletedTenants = 0;
  for (const t of tenants) {
    if (t.sub) {
      try {
        await qp.cancelSubscription(t.sub);
      } catch (e) {
        if (!(e instanceof QuickPayError && e.status >= 400 && e.status < 500)) {
          console.error(`  ! ${t.name}: the card at QuickPay couldn't be cancelled; kept.`);
          continue;
        }
      }
    }
    await db.query('begin');
    await db.query(`select set_config('app.tenant_id', $1, true)`, [t.id]);
    await db.query(`delete from tenants where id = $1`, [t.id]);
    await db.query('commit');
    deletedTenants++;
  }

  await db.query('begin');
  await db.query(`delete from platform.staff where user_id <> $1`, [kept.id]);
  await db.query(`update platform.staff set role = 'superadmin' where user_id = $1`, [kept.id]);
  // Sessions, accounts, passkeys, two-step login and profiles go with the user (cascade).
  await db.query(`delete from auth.users where id <> $1`, [kept.id]);
  await db.query(`delete from auth.verifications`);
  await db.query('commit');

  if (env.STORAGE_DIR)
    for (const u of users)
      await rm(join(resolve(env.STORAGE_DIR), 'avatars', u.id), { recursive: true, force: true });

  console.log(
    `\nDeleted ${deletedTenants} of ${tenants.length} companies, ${users.length} logins and ` +
      `${staff.length} staff roles. ${keep} is the only Super Administrator.`,
  );
} catch (e) {
  await db.query('rollback').catch(() => undefined);
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.end();
}
