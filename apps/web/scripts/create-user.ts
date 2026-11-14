/**
 * Creates a verified login on a server where e-mail isn't set up yet (or resets the password of
 * an existing one). The person then signs in, creates their company in onboarding and becomes
 * its Ejer; owners and admins enrol MFA on first sign-in. The password is read from the
 * environment and never printed.
 *
 *   NEW_EMAIL=… NEW_NAME=… NEW_PASSWORD=… node --env-file=<web env> --import tsx scripts/create-user.ts
 */
import { z } from 'zod';

const input = z
  .object({
    NEW_EMAIL: z.email(),
    NEW_NAME: z.string().trim().min(1).max(120),
    NEW_PASSWORD: z.string().min(12, 'at least 12 characters').max(128),
  })
  .safeParse(process.env);
if (!input.success) {
  console.error(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const { NEW_EMAIL: email, NEW_NAME: name, NEW_PASSWORD: password } = input.data;

const { auth } = await import('../src/server/auth/auth');
const ctx = await auth().$context;
const hash = await ctx.password.hash(password);
const existing = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());

if (existing) {
  await ctx.internalAdapter.updatePassword(existing.user.id, hash);
  await ctx.internalAdapter.updateUser(existing.user.id, { emailVerified: true });
  console.log(`Updated ${email}: password set, e-mail marked verified.`);
} else {
  const user = await ctx.internalAdapter.createUser(
    { email: email.toLowerCase(), name, emailVerified: true },
    { method: 'email-password' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  });
  console.log(`Created ${email}. Sign in and create the company in onboarding.`);
}
process.exit(0);
