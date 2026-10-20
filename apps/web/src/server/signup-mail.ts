import type { SignupReceipt } from '@agentor/db';
import { sendMail } from './mail';

/**
 * Signup mails (PLAN-SIGNUP §5). Plain text like the other transactional mails. Sending is never
 * awaited by the caller's response path, so a new and an existing e-mail answer equally fast.
 */

export async function sendSignupCode(email: string, code: string): Promise<void> {
  await sendMail({
    to: email,
    subject: `${code} er din kode til Agentor`,
    text: `Hej

Din kode til at bekræfte din e-mail hos Agentor er:

${code}

Koden virker i 10 minutter. Har du ikke oprettet en konto, kan du se bort fra denne mail.

Venlig hilsen
Agentor`,
  });
}

export async function sendAlreadyHaveAccount(email: string, loginUrl: string): Promise<void> {
  await sendMail({
    to: email,
    subject: 'Du har allerede en konto hos Agentor',
    text: `Hej

Nogen (forhåbentlig dig) forsøgte at oprette en konto med denne e-mail. Du har allerede en konto, så du kan bare logge ind:

${loginUrl}

Har du glemt adgangskoden, kan du nulstille den på login-siden.

Venlig hilsen
Agentor`,
  });
}

/** Fire and forget: a mail outage must not change what the visitor sees. */
export function sendInBackground(p: Promise<void>, what: string): void {
  void p.catch((err: unknown) => {
    // Constant format string: `what` must not be read as format specifiers (Semgrep).
    console.error('%s mail failed: %s', what, err instanceof Error ? err.message : String(err));
  });
}

const kr = (ore: number) =>
  (ore / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: Date) =>
  d.toLocaleDateString('da-DK', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Copenhagen',
  });

/** The receipt for the first payment (Q20), sent once to the billing e-mail. */
export async function sendSignupReceipt(
  to: string,
  r: SignupReceipt,
  billingUrl: string,
): Promise<void> {
  const period = r.interval === 'year' ? 'årligt' : 'månedligt';
  await sendMail({
    to,
    subject: `Kvittering for dit abonnement hos Agentor${r.invoiceNumber ? ` (faktura ${r.invoiceNumber})` : ''}`,
    text: `Hej

Tak for din betaling. ${r.companyName} har nu ${r.planName}, betalt ${period}.

Faktura: ${r.invoiceNumber ?? '–'}
Periode: ${day(r.periodStart)} – ${day(r.periodEnd)}
Beløb uden moms: ${kr(r.amountOre)} kr.
Moms 25 %: ${kr(r.vatOre)} kr.
Betalt i alt: ${kr(r.amountOre + r.vatOre)} kr.${r.paidAt ? `\nBetalt: ${day(r.paidAt)}` : ''}

Fakturaen som PDF og dine betalinger finder du under Abonnement:
${billingUrl}

Venlig hilsen
Agentor`,
  });
}
