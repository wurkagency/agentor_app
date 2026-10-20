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
    console.error(`${what} mail failed`, err instanceof Error ? err.message : err);
  });
}
