import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

/**
 * Transactional e-mail over SMTP: Mailpit locally, Brevo SMTP in production
 * (produktspecifikation §10.2). Messages never contain secrets; links expire.
 */
let transport: Transporter | undefined;

function transporter(): Transporter {
  transport ??= nodemailer.createTransport(env().SMTP_URL);
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  await transporter().sendMail({
    from: env().MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}
