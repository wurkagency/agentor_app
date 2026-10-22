import { createHash, timingSafeEqual } from 'node:crypto';
import { CHECKSUM_HEADER, verifyCallback } from '@agentor/billing';
import Fastify, { type FastifyInstance } from 'fastify';

export interface IngestDeps {
  /** QuickPay account private key; without it the billing callback answers 404. */
  quickpayPrivateKey?: string | undefined;
  /** Enqueues a verified QuickPay callback; jobId makes redelivery idempotent. */
  enqueueQuickPay?: ((body: string, jobId: string) => Promise<void>) | undefined;
  /** Stores a webhook for a known token (app.ingest_webhook); null for unknown tokens. */
  storeWebhook?:
    | ((
        token: string,
        headers: Record<string, string>,
        body: Buffer,
      ) => Promise<{ eventId: string; tenantId: string } | null>)
    | undefined;
  enqueueWebhook?: ((tenantId: string, eventId: string) => Promise<void>) | undefined;
  /** Shared secret for inbound mail (Brevo Inbound Parsing); without it /mail/inbound is 404. */
  inboundSecret?: string | undefined;
  /** Adds a reply to the case behind sag+<token>@… (app.case_reply_by_email). */
  caseReply?: ((token: string, from: string, body: string) => Promise<string>) | undefined;
}

/** One message from Brevo Inbound Parsing (only the fields used here). */
interface InboundItem {
  From?: { Address?: string };
  To?: { Address?: string }[];
  Cc?: { Address?: string }[];
  ExtractedMarkdownMessage?: string;
  RawTextBody?: string;
}

/** The reply without the quoted original: Brevo's extracted message, or the text cut at the quote. */
export function replyText(item: InboundItem): string {
  const extracted = item.ExtractedMarkdownMessage?.trim();
  if (extracted) return extracted;
  const lines: string[] = [];
  for (const line of (item.RawTextBody ?? '').split(/\r?\n/)) {
    if (/^>/.test(line)) break;
    if (/^(Den|On) .+\b(skrev|wrote)\b.*:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*(Original|Oprindelig)/i.test(line.trim())) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

const CASE_ADDRESS = /^sag\+([a-z0-9]{20,64})@/i;

const sameSecret = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

/** Headers kept with a webhook: signatures, topics and delivery ids. Nothing else is stored. */
const KEEP_HEADERS = /^(x-wc-webhook-|x-shopify-|content-type$)/;

/**
 * agentor-ingest: receives webhooks, verifies them, enqueues, answers 200 fast
 * (produktspecifikation §9.4, §10.1). Signature verification and enqueueing per connection
 * arrive with the connector SDK in M5; M0 ships the hardened server shell.
 */
export function buildApp(
  options: { logger?: boolean | object } & IngestDeps = {},
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024, // 1 MiB: webhook payloads are small; anything larger is refused
    trustProxy: 'loopback', // Plesk/Nginx terminates TLS on the same host
    disableRequestLogging: false,
    return503OnClosing: true,
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Signatures are computed over the exact bytes received, so bodies stay raw buffers.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  // QuickPay callbacks (D4): verify, enqueue, answer fast. The worker applies them.
  app.post('/billing/quickpay', async (req, reply) => {
    const { quickpayPrivateKey, enqueueQuickPay } = options;
    if (!quickpayPrivateKey || !enqueueQuickPay) return reply.code(404).send();
    const raw = Buffer.isBuffer(req.body) ? req.body : null;
    const sig = req.headers[CHECKSUM_HEADER];
    if (
      !raw ||
      !verifyCallback(raw, typeof sig === 'string' ? sig : undefined, quickpayPrivateKey)
    ) {
      req.log.warn('quickpay callback with invalid signature');
      return reply.code(401).send();
    }
    const jobId = `qp-${createHash('sha256').update(raw).digest('hex')}`;
    await enqueueQuickPay(raw.toString('utf8'), jobId);
    return reply.code(202).send();
  });

  // Webhooks (produktspecifikation §9.4): an unguessable token per connection. The event is
  // stored and queued; the worker verifies the signature with the connection's secret, which
  // this process can't read. Unknown tokens get a plain 404 that reveals nothing.
  app.post<{ Params: { token: string } }>('/hooks/:token', async (req, reply) => {
    const { storeWebhook, enqueueWebhook } = options;
    const raw = Buffer.isBuffer(req.body) ? req.body : null;
    if (!storeWebhook || !enqueueWebhook || !raw) return reply.code(404).send();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (KEEP_HEADERS.test(k) && typeof v === 'string') headers[k] = v.slice(0, 512);
    const stored = await storeWebhook(req.params.token, headers, raw);
    if (!stored) return reply.code(404).send();
    await enqueueWebhook(stored.tenantId, stored.eventId);
    return reply.code(202).send();
  });
  app.all('/hooks/*', async (_req, reply) => reply.code(404).send());

  // Replies to a resolved case (E12): Brevo Inbound Parsing posts the parsed mail here. The
  // secret is in the URL Brevo is given (?secret=…) or the x-agentor-inbound-secret header.
  // Unknown cases, strangers and archived cases are dropped quietly with 200, so nothing is
  // revealed and Brevo doesn't retry. Bodies are never logged.
  app.post<{ Querystring: { secret?: string } }>('/mail/inbound', async (req, reply) => {
    const { inboundSecret, caseReply } = options;
    if (!inboundSecret || !caseReply) return reply.code(404).send();
    const header = req.headers['x-agentor-inbound-secret'];
    const given = typeof header === 'string' ? header : (req.query.secret ?? '');
    if (!given || !sameSecret(given, inboundSecret)) return reply.code(401).send();
    let items: InboundItem[];
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const parsed = JSON.parse(raw) as { items?: InboundItem[] };
      items = Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : [];
    } catch {
      return reply.code(400).send();
    }
    for (const item of items) {
      const to = [...(item.To ?? []), ...(item.Cc ?? [])]
        .map((a) => a.Address ?? '')
        .map((a) => CASE_ADDRESS.exec(a)?.[1])
        .find(Boolean);
      const from = item.From?.Address ?? '';
      if (!to || !from) continue;
      const result = await caseReply(to.toLowerCase(), from, replyText(item));
      req.log.info({ result }, 'case reply by e-mail');
    }
    return reply.code(200).send();
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send());
  return app;
}
