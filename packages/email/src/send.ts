import { createHash } from 'node:crypto';
import type { Transporter } from 'nodemailer';
import type { Locale } from '@agentor/i18n';
import { renderEmail, type EmailKey, type EmailProps } from './registry.js';

/**
 * The one way Agentor sends e-mail (PLAN-EMAILS-PDF §3.3): renders the template, sends HTML and
 * text over the given transport (Mailpit locally, Brevo SMTP in production) and retries
 * transient failures. Logs only the template, a hash of the recipient and the message id; never
 * the subject, body, codes or links.
 */
export interface MailLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface MailerConfig {
  transport: Pick<Transporter, 'sendMail'>;
  from: string;
  appUrl: string;
  log?: MailLog;
  /** Waits between attempts; tests pass [0, 0]. */
  backoffMs?: number[];
}

export interface SendOptions {
  to: string;
  locale?: Locale;
  replyTo?: string;
  attachments?: { filename: string; content: string | Buffer; contentType: string }[];
  /** One id per event (notification id, invoice id …): X-Entity-Ref-ID, so clients don't thread. */
  entityRef?: string;
  /** E22: the one-click unsubscribe URL (RFC 8058). */
  unsubscribeUrl?: string;
  now?: Date;
}

export interface SendResult {
  messageId: string;
}

/** First 12 hex characters of sha256(lower-case address): enough to correlate, not to read. */
export const recipientHash = (to: string) =>
  createHash('sha256').update(to.trim().toLowerCase()).digest('hex').slice(0, 12);

/** One JSON line per event on stdout/stderr, like the worker's pino output. */
const consoleLog: MailLog = {
  info: (o, m) => process.stdout.write(`${JSON.stringify({ level: 'info', msg: m, ...o })}\n`),
  warn: (o, m) => process.stderr.write(`${JSON.stringify({ level: 'warn', msg: m, ...o })}\n`),
};

/** SMTP and connection errors worth another try: timeouts, refused connections, 4xx replies. */
function transient(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  return ['ECONNECTION', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'EDNS'].includes(
    e.code ?? '',
  );
}

export function createMailer(cfg: MailerConfig) {
  const log = cfg.log ?? consoleLog;
  const backoff = cfg.backoffMs ?? [500, 2000, 8000];

  return async function sendEmail<K extends EmailKey>(
    key: K,
    props: EmailProps[K],
    opts: SendOptions,
  ): Promise<SendResult> {
    const mail = renderEmail(key, props, {
      appUrl: cfg.appUrl,
      locale: opts.locale ?? 'da',
      ...(opts.now ? { now: opts.now } : {}),
    });
    const headers: Record<string, string> = {};
    if (opts.entityRef) headers['X-Entity-Ref-ID'] = opts.entityRef;
    if (opts.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    const to = recipientHash(opts.to);
    for (let attempt = 1; ; attempt++) {
      try {
        const info = (await cfg.transport.sendMail({
          from: cfg.from,
          to: opts.to,
          ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers,
          ...(opts.attachments ? { attachments: opts.attachments } : {}),
        })) as { messageId?: string };
        const messageId = info.messageId ?? '';
        log.info({ template: key, to, messageId, attempt }, 'email sent');
        return { messageId };
      } catch (err) {
        const wait = backoff[attempt - 1];
        const code =
          (err as { code?: string; responseCode?: number }).responseCode ??
          (err as { code?: string }).code ??
          'unknown';
        if (wait === undefined || !transient(err)) {
          log.warn({ template: key, to, attempt, code }, 'email failed');
          throw err;
        }
        log.warn({ template: key, to, attempt, code }, 'email retry');
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };
}

export type SendEmail = ReturnType<typeof createMailer>;
