import { afterAll, describe, expect, it } from 'vitest';
import { CHECKSUM_HEADER, signCallback } from '@agentor/billing';
import { buildApp } from './app.js';

const app = buildApp();
afterAll(() => app.close());

describe('ingest server', () => {
  it('answers health checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('answers unknown hook paths with an empty 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hooks/does-not-exist',
      payload: { a: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });

  it('refuses bodies above 1 MiB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hooks/x',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
  });
});

describe('QuickPay callbacks', () => {
  const key = 'test-private-key';
  const queued: { body: string; jobId: string }[] = [];
  const qp = buildApp({
    quickpayPrivateKey: key,
    enqueueQuickPay: async (body, jobId) => {
      queued.push({ body, jobId });
    },
  });
  afterAll(() => qp.close());
  const body = JSON.stringify({ id: 1, type: 'Subscription', order_id: 'AG1234', accepted: true });

  it('enqueues a correctly signed callback, byte for byte', async () => {
    const res = await qp.inject({
      method: 'POST',
      url: '/billing/quickpay',
      headers: { 'content-type': 'application/json', [CHECKSUM_HEADER]: signCallback(body, key) },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.body).toBe(body);
    expect(queued[0]!.jobId).toMatch(/^qp-[0-9a-f]{64}$/);
  });

  it('refuses a missing or wrong signature without enqueueing', async () => {
    for (const sig of [undefined, signCallback(body, 'other'), 'nonsense']) {
      const res = await qp.inject({
        method: 'POST',
        url: '/billing/quickpay',
        headers: { 'content-type': 'application/json', ...(sig ? { [CHECKSUM_HEADER]: sig } : {}) },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    }
    expect(queued).toHaveLength(1);
  });

  it('is not served when billing is not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/quickpay',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('connection webhooks', () => {
  const stored: { token: string; headers: Record<string, string>; body: string }[] = [];
  const queued: string[] = [];
  const hooks = buildApp({
    storeWebhook: async (token, headers, body) => {
      if (token !== 'k'.repeat(43)) return null;
      stored.push({ token, headers, body: body.toString() });
      return { eventId: 'e1', tenantId: 't1' };
    },
    enqueueWebhook: async (_t, eventId) => {
      queued.push(eventId);
    },
  });
  afterAll(() => hooks.close());

  it('stores and queues a webhook for a known token, keeping only signature headers', async () => {
    const res = await hooks.inject({
      method: 'POST',
      url: `/hooks/${'k'.repeat(43)}`,
      headers: {
        'content-type': 'application/json',
        'x-wc-webhook-signature': 'sig',
        cookie: 'should-not-be-stored',
      },
      payload: '{"id":10447}',
    });
    expect(res.statusCode).toBe(202);
    expect(stored[0]!.body).toBe('{"id":10447}');
    expect(stored[0]!.headers).toEqual({
      'content-type': 'application/json',
      'x-wc-webhook-signature': 'sig',
    });
    expect(queued).toEqual(['e1']);
  });

  it('answers unknown tokens with an empty 404 and queues nothing', async () => {
    const res = await hooks.inject({
      method: 'POST',
      url: `/hooks/${'x'.repeat(43)}`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
    expect(queued).toHaveLength(1);
  });
});
