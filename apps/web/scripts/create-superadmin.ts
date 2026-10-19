/**
 * Creates (or updates) a Superadmin in one step, on a server or locally: the login with a
 * password typed at a hidden prompt, and the Superadmin role on Agentor Platform. Two-step login
 * is set up at the first sign-in. Nothing secret is passed on the command line or printed.
 *
 *   SUPERADMIN_EMAIL=… SUPERADMIN_NAME="…" node --env-file=<web env> --env-file=<deploy env> \
 *     --import tsx scripts/create-superadmin.ts
 *
 * On the server this is wrapped as `agentor-superadmin <email> "<name>"` (infra/scripts).
 * Needs the web env (auth secret, DATABASE_URL) and DATABASE_URL_OWNER for the staff role.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import pg from 'pg';
import { z } from 'zod';

const input = z
  .object({
    SUPERADMIN_EMAIL: z.email(),
    SUPERADMIN_NAME: z.string().trim().min(1).max(120),
    DATABASE_URL_OWNER: z.string().min(1),
    /** Optional; when unset the password is asked for at a hidden prompt. */
    SUPERADMIN_PASSWORD: z.string().optional(),
  })
  .safeParse(process.env);
if (!input.success) {
  console.error(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const { SUPERADMIN_EMAIL, SUPERADMIN_NAME: name, DATABASE_URL_OWNER: ownerUrl } = input.data;
const email = SUPERADMIN_EMAIL.toLowerCase();

/** Reads a line without echoing it. */
function ask(prompt: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

let password = input.data.SUPERADMIN_PASSWORD ?? '';
if (!password) {
  password = await ask('Password (at least 12 characters): ');
  const again = await ask('Repeat password: ');
  if (password !== again) {
    console.error('The passwords are not the same.');
    process.exit(1);
  }
}
if (password.length < 12 || password.length > 128) {
  console.error('The password must be 12 to 128 characters.');
  process.exit(1);
}

const { auth } = await import('../src/server/auth/auth');
const ctx = await auth().$context;
const hash = await ctx.password.hash(password);
const existing = await ctx.internalAdapter.findUserByEmail(email);
let userId: string;
if (existing) {
  userId = existing.user.id;
  await ctx.internalAdapter.updatePassword(userId, hash);
  await ctx.internalAdapter.updateUser(userId, { name, emailVerified: true });
} else {
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: 'email-password' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  });
  userId = user.id;
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  await client.query(
    `insert into platform.staff (user_id, role, created_by_name) values ($1, 'superadmin', 'create-superadmin')
     on conflict (user_id) do update set role = 'superadmin', disabled_at = null`,
    [userId],
  );
  await client.query(
    `insert into platform.audit (actor_user_id, actor_name, action, detail) values ($1, 'create-superadmin', 'staff.saved', $2)`,
    [userId, { email, role: 'superadmin' }],
  );
} finally {
  await client.end();
}
console.log(
  `${name} <${email}> is Superadmin${existing ? ' (existing login, password updated)' : ''}. ` +
    'Two-step login is set up at the first sign-in.',
);
process.exit(0);
