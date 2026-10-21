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

  it('gives the same callback twice the same job id, so it is applied once', async () => {
    const send = (payload: string) =>
      qp.inject({
        method: 'POST',
        url: '/billing/quickpay',
        headers: {
          'content-type': 'application/json',
          [CHECKSUM_HEADER]: signCallback(payload, key),
        },
        payload,
      });
    const payment = JSON.stringify({ id: 9, type: 'Payment', order_id: 'AG5678', accepted: true });
    const before = queued.length;
    expect((await send(payment)).statusCode).toBe(202);
    expect((await send(payment)).statusCode).toBe(202);
    const ids = queued.slice(before).map((q) => q.jobId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('refuses a signed body that was changed afterwards', async () => {
    const signed = signCallback(body, key);
    const tampered = body.replace('"accepted":true', '"accepted":false');
    const before = queued.length;
    const res = await qp.inject({
      method: 'POST',
      url: '/billing/quickpay',
      headers: { 'content-type': 'application/json', [CHECKSUM_HEADER]: signed },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
    expect(queued).toHaveLength(before);
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

describe('inbound mail (E12 replies)', () => {
  const calls: [string, string, string][] = [];
  const mail = buildApp({
    inboundSecret: 'test-inbound-secret',
    caseReply: async (token, from, body) => {
      calls.push([token, from, body]);
      return 'reopened';
    },
  });
  afterAll(() => mail.close());
  const item = {
    From: { Address: 'mette@nordlys-cykler.dk' },
    To: [{ Address: 'sag+0123456789abcdef0123456789abcdef@svar.agentor.dk' }],
    RawTextBody: 'Det virker ikke igen.\n\nDen 21. okt. 2026 skrev Agentor:\n> Din sag er løst',
  };

  it('refuses a wrong or missing secret', async () => {
    for (const url of ['/mail/inbound', '/mail/inbound?secret=nope']) {
      const res = await mail.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ items: [item] }),
      });
      expect(res.statusCode).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('adds the reply without the quoted original', async () => {
    const res = await mail.inject({
      method: 'POST',
      url: '/mail/inbound',
      headers: {
        'content-type': 'application/json',
        'x-agentor-inbound-secret': 'test-inbound-secret',
      },
      payload: JSON.stringify({ items: [item, { ...item, To: [{ Address: 'x@agentor.dk' }] }] }),
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([
      ['0123456789abcdef0123456789abcdef', 'mette@nordlys-cykler.dk', 'Det virker ikke igen.'],
    ]);
  });

  it('is off without a secret', async () => {
    const res = await app.inject({ method: 'POST', url: '/mail/inbound', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
