import Fastify, { type FastifyInstance } from 'fastify';

/**
 * agentor-ingest: receives webhooks, verifies them, enqueues, answers 200 fast
 * (produktspecifikation §9.4, §10.1). Signature verification and enqueueing per connection
 * arrive with the connector SDK in M5; M0 ships the hardened server shell.
 */
export function buildApp(options: { logger?: boolean | object } = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024, // 1 MiB: webhook payloads are small; anything larger is refused
    trustProxy: 'loopback', // Plesk/Nginx terminates TLS on the same host
    disableRequestLogging: false,
    return503OnClosing: true,
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Webhook endpoints are unguessable per-connection paths (M5). Until then, every hook
  // path is unknown and answered with a plain 404 that reveals nothing.
  app.all('/hooks/*', async (_req, reply) => reply.code(404).send());

  app.setNotFoundHandler((_req, reply) => reply.code(404).send());
  return app;
}
