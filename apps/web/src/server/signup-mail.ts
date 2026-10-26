import type { SignupReceipt } from '@agentor/db';
import { brandName } from '../components/billing/card';
import { appLink, sendEmail } from './mail';

/**
 * Signup mails (PLAN-SIGNUP §5). Sending is never awaited by the caller's response path, so a new
 * and an existing e-mail answer equally fast.
 */

/** E06: signup step 1 and "send koden igen". */
export async function sendSignupCode(email: string, code: string): Promise<void> {
  await sendEmail('signup-code', { code, email }, { to: email });
}

/** E07: instead of E06 when the address already has an account. */
export async function sendAlreadyHaveAccount(email: string, loginUrl: string): Promise<void> {
  await sendEmail('signup-existing-account', { email, loginUrl }, { to: email });
}

/** Fire and forget: a mail outage must not change what the visitor sees. */
export function sendInBackground(p: Promise<void>, what: string): void {
  void p.catch((err: unknown) => {
    // Constant format string: `what` must not be read as format specifiers (Semgrep).
    console.error('%s mail failed: %s', what, err instanceof Error ? err.message : String(err));
  });
}

/** E08: the receipt for the first payment (Q20), sent once to the billing e-mail. */
export async function sendSignupReceipt(to: string, r: SignupReceipt): Promise<void> {
  await sendEmail(
    'subscription-receipt',
    {
      company: r.companyName,
      plan: r.planName,
      interval: r.interval,
      invoiceNumber: r.invoiceNumber ?? '–',
      periodStart: r.periodStart,
      // periodEnd is exclusive; the receipt shows the last day.
      periodEnd: new Date(r.periodEnd.getTime() - 1),
      paidAt: r.paidAt,
      card: r.cardLast4 ? `${brandName(r.cardBrand)} •••• ${r.cardLast4}` : null,
      netOre: r.amountOre,
      vatOre: r.vatOre,
      // The PDF behind login, not attached (README decision 26).
      url: appLink(`/billing/invoices/${r.invoiceId}/pdf`),
      billingEmail: to,
    },
    { to, entityRef: `invoice-${r.invoiceId}` },
  );
}
