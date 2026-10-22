/**
 * Makes an existing Agentor login Agentor staff (README decision 16). Used once on a server to
 * create the first Superadmin; after that, Superadmin manages staff under Platformbrugere (P6).
 * Staff get no customer data by this: support access is still per case, time-limited and
 * approved by the customer.
 *
 *   STAFF_EMAIL=… STAFF_ROLE=superadmin|supporter DATABASE_URL_OWNER=… node --import tsx scripts/create-staff.ts
 */
import pg from 'pg';
import { z } from 'zod';

const input = z
  .object({
    STAFF_EMAIL: z.email(),
    STAFF_ROLE: z.enum(['superadmin', 'supporter']).default('superadmin'),
    DATABASE_URL_OWNER: z.string().min(1),
  })
  .safeParse(process.env);
if (!input.success) {
  console.error(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const { STAFF_EMAIL: email, STAFF_ROLE: role, DATABASE_URL_OWNER: url } = input.data;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const user = await client.query<{ id: string; name: string }>(
    `select id, name from auth.users where lower(email) = lower($1)`,
    [email],
  );
  const u = user.rows[0];
  if (!u) {
    console.error(`No login with ${email}. Create it first (scripts/create-user.ts) or sign up.`);
    process.exit(1);
  }
  await client.query(
    `insert into platform.staff (user_id, role, created_by_name) values ($1, $2, 'create-staff')
     on conflict (user_id) do update set role = excluded.role, disabled_at = null`,
    [u.id, role],
  );
  await client.query(
    `insert into platform.audit (actor_user_id, actor_name, action, detail) values ($1, 'create-staff', 'staff.saved', $2)`,
    [u.id, { email, role }],
  );
  console.log(`${u.name} <${email}> is now ${role}. Two-step login is required on first sign-in.`);
} finally {
  await client.end();
}
