import { describe, expect, it, vi } from 'vitest';
import {
  createQuickPay,
  HttpQuickPayClient,
  MockQuickPayClient,
  newOrderId,
  parseCallback,
  signCallback,
  verifyCallback,
} from '../src/quickpay.js';

const KEY = 'test-private-key';

describe('callback signatures', () => {
  const body = JSON.stringify({
    id: 1,
    type: 'Subscription',
    order_id: 'AG123456',
    accepted: true,
  });
  it('accepts the right checksum and nothing else', () => {
    const sig = signCallback(body, KEY);
    expect(verifyCallback(body, sig, KEY)).toBe(true);
    expect(verifyCallback(body, sig.toUpperCase(), KEY)).toBe(true);
    expect(verifyCallback(`${body} `, sig, KEY)).toBe(false);
    expect(verifyCallback(body, signCallback(body, 'other'), KEY)).toBe(false);
    expect(verifyCallback(body, undefined, KEY)).toBe(false);
    expect(verifyCallback(body, 'abc', KEY)).toBe(false);
    expect(verifyCallback(body, sig, '')).toBe(false);
  });
});

describe('parseCallback', () => {
  const sub = {
    id: 99,
    type: 'Subscription',
    order_id: 'AGABC123',
    accepted: true,
    test_mode: true,
    metadata: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 },
  };
  it('extracts card details', () => {
    expect(parseCallback(JSON.stringify(sub), 'test')).toMatchObject({
      id: '99',
      orderId: 'AGABC123',
      card: { brand: 'visa', last4: '4242', expiry: '08/28' },
    });
  });
  it('refuses test-mode callbacks in live mode', () => {
    expect(() => parseCallback(JSON.stringify(sub), 'live')).toThrow(/test-mode/);
  });
  it('refuses malformed order ids', () => {
    expect(() => parseCallback(JSON.stringify({ ...sub, order_id: '../x' }), 'test')).toThrow();
  });
});

describe('clients', () => {
  it('order ids fit QuickPay and the billing index', () => {
    for (let i = 0; i < 50; i++) expect(newOrderId()).toMatch(/^AG[0-9A-Z]{12}$/);
  });

  it('mock mode never touches the network and is refused in production', () => {
    expect(createQuickPay({ APP_URL: 'http://localhost:3000' })).toBeInstanceOf(MockQuickPayClient);
    expect(() =>
      createQuickPay({ APP_URL: 'https://app.agentor.dk', NODE_ENV: 'production' }),
    ).toThrow(/not allowed/);
    expect(() => createQuickPay({ APP_URL: 'x', QUICKPAY_MODE: 'prod' })).toThrow();
  });

  it('calls the v10 API with basic auth and the callback header', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: 7, accepted: true, state: 'processed' }),
    );
    const qp = new HttpQuickPayClient(
      'test',
      'api-key',
      fetchMock as typeof fetch,
      'https://qp.test',
    );
    const r = await qp.recurring({
      subscriptionId: '42',
      orderId: 'AGX1234',
      amountOre: 19875,
      callbackUrl: 'https://ingest.example/billing/quickpay',
    });
    expect(r).toEqual({ paymentId: '7', accepted: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qp.test/subscriptions/42/recurring?synchronized');
    const headers = init.headers as Record<string, string>;
    expect(headers['Accept-Version']).toBe('v10');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(':api-key').toString('base64')}`);
    expect(headers['QuickPay-Callback-Url']).toBe('https://ingest.example/billing/quickpay');
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 19875,
      order_id: 'AGX1234',
      auto_capture: true,
    });
  });

  it('refunds synchronously and accepts only an approved refund operation', async () => {
    const reply = (code: string | null) =>
      vi.fn(async () =>
        Response.json({
          id: 7,
          operations: [
            { id: 1, type: 'capture', qp_status_code: '20000' },
            { id: 2, type: 'refund', qp_status_code: code },
          ],
        }),
      );
    const ok = reply('20000');
    const qp = new HttpQuickPayClient('test', 'k', ok as typeof fetch, 'https://qp.test');
    const r = await qp.refund({
      paymentId: '7',
      amountOre: 40000,
      callbackUrl: 'https://ingest.example/billing/quickpay',
    });
    expect(r).toEqual({ state: 'accepted', operationId: '2' });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qp.test/payments/7/refund?synchronized');
    expect(JSON.parse(String(init.body))).toEqual({ amount: 40000 });
    const declined = new HttpQuickPayClient(
      'test',
      'k',
      reply('40000') as typeof fetch,
      'https://qp.test',
    );
    expect(
      (await declined.refund({ paymentId: '7', amountOre: 1, callbackUrl: 'https://x.test' }))
        .state,
    ).toBe('rejected');
    // No status yet: the refund may still go through, so it is not a failure.
    const open = new HttpQuickPayClient(
      'test',
      'k',
      reply(null) as typeof fetch,
      'https://qp.test',
    );
    expect((await open.refund({ paymentId: '7', amountOre: 1 })).state).toBe('unknown');
  });

  it('offers card only in the payment window', async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: 'https://payment.quickpay.net/x' }));
    const qp = new HttpQuickPayClient('test', 'k', fetchMock as typeof fetch, 'https://qp.test');
    await qp.subscriptionLink({
      subscriptionId: '42',
      orderId: 'AGX1234',
      amountOre: 198750,
      continueUrl: 'https://app.example/signup/payment?return=1',
      cancelUrl: 'https://app.example/signup/payment?cancelled=1',
      callbackUrl: 'https://ingest.example/billing/quickpay',
      language: 'da',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qp.test/subscriptions/42/link');
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 198750,
      payment_methods: 'creditcard',
    });
  });

  it('mock charges send the signed Payment callback QuickPay would send', async () => {
    vi.useFakeTimers();
    const posted: { url: string; body: string; checksum: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      posted.push({
        url,
        body: String(init.body),
        checksum: (init.headers as Record<string, string>)['quickpay-checksum-sha256']!,
      });
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    try {
      const qp = new MockQuickPayClient('http://localhost:3000', 'private');
      const r = await qp.recurring({
        subscriptionId: 'mock_AGX1234',
        orderId: 'AGCHARGE01',
        amountOre: 100,
        callbackUrl: 'http://ingest.test/billing/quickpay',
      });
      expect(r.accepted).toBe(true);
      await vi.runAllTimersAsync();
      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe('http://ingest.test/billing/quickpay');
      expect(verifyCallback(posted[0]!.body, posted[0]!.checksum, 'private')).toBe(true);
      expect(JSON.parse(posted[0]!.body)).toMatchObject({
        type: 'Payment',
        order_id: 'AGCHARGE01',
        accepted: true,
      });
    } finally {
      globalThis.fetch = realFetch;
      vi.useRealTimers();
    }
  });

  it('reports errors without echoing the response body', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"message":"card 4111..."}', { status: 400 }),
    );
    const qp = new HttpQuickPayClient('test', 'k', fetchMock as typeof fetch);
    await expect(qp.createSubscription('AG1234', 'x')).rejects.toThrow(
      /^QuickPay POST subscriptions failed$/,
    );
  });
});
