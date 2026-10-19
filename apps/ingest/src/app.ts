import { createHash } from 'node:crypto';
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
}

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

  app.setNotFoundHandler((_req, reply) => reply.code(404).send());
  return app;
}
