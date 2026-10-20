import { claimSignupReceipt, releaseSignupReceipt } from '@agentor/db';
import { env } from './env';
import { db } from './infra';
import { sendSignupReceipt } from './signup-mail';

/**
 * Mails the receipt for the first payment once (Q20), the first time SU6 or Overblik sees the
 * company as active. The worker that activates has no mail; the database claim makes it once.
 * Never blocks the page: a failed send releases the claim, so the next page view tries again.
 */
export async function ensureSignupReceipt(
  ctx: { tenantId: string; userId: string },
  fallbackEmail: string,
): Promise<void> {
  try {
    const r = await claimSignupReceipt(db(), ctx);
    if (!r) return;
    const billingUrl = new URL('/billing', env().APP_URL).toString();
    void sendSignupReceipt(r.billingEmail ?? fallbackEmail, r, billingUrl).catch(
      async (err: unknown) => {
        console.error('signup receipt mail failed', err instanceof Error ? err.message : err);
        await releaseSignupReceipt(db(), ctx).catch(() => undefined);
      },
    );
  } catch (err) {
    console.error('signup receipt claim failed', err instanceof Error ? err.message : err);
  }
}
