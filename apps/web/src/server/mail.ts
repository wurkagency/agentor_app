import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from './env';

/**
 * Transactional e-mail over SMTP: Mailpit locally, Brevo SMTP in production
 * (produktspecifikation §10.2). Messages never contain secrets; links expire.
 */
let transport: Transporter | undefined;

/** Mailpit (docker compose) in development and tests. */
const DEV_SMTP = 'smtp://127.0.0.1:51025';

function transporter(): Transporter {
  const url = env().SMTP_URL;
  // In production a missing SMTP_URL would send everything to a local port that nothing listens
  // on, and signup codes would vanish without a trace. Fail loudly instead.
  if (!url && isProduction()) throw new Error('SMTP_URL is not set: no mail can be sent');
  transport ??= nodemailer.createTransport(url ?? DEV_SMTP);
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Small generated files only (Finans CSV reports). */
  attachments?: { filename: string; content: string; contentType: string }[];
}

export async function sendMail(mail: Mail): Promise<void> {
  await transporter().sendMail({
    from: env().MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.attachments ? { attachments: mail.attachments } : {}),
  });
}
