import {
  createMailer,
  type EmailKey,
  type EmailProps,
  type SendEmail,
  type SendOptions,
  type SendResult,
} from '@agentor/email';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from './env';

/**
 * Transactional e-mail over SMTP: Mailpit locally, Brevo SMTP in production
 * (produktspecifikation §10.2). Every mail is a designed template from @agentor/email
 * (README decision 26) with an HTML and a text version; callers pass typed props only.
 */
let transport: Transporter | undefined;
let mailer: SendEmail | undefined;

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

/** sendEmail('team-invite', props, { to }): renders the template and sends it. */
export function sendEmail<K extends EmailKey>(
  key: K,
  props: EmailProps[K],
  opts: SendOptions,
): Promise<SendResult> {
  mailer ??= createMailer({
    transport: transporter(),
    from: env().MAIL_FROM,
    appUrl: env().APP_URL,
  });
  return mailer(key, props, opts);
}

/** An absolute link into the app (every link in a mail is absolute, README decision 26). */
export const appLink = (path: string) => new URL(path, env().APP_URL).toString();
