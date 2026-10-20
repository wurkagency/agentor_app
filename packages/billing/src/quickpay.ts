import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * QuickPay subscriptions (produktspecifikation D4): the card is saved on a QuickPay subscription
 * and charged monthly with a "recurring" payment started by agentor-scheduler.
 *
 * Modes: `mock` (local development and e2e; no network, the card form is an app page),
 * `test` (QuickPay test merchant, test cards only) and `live`.
 */

export type QuickPayMode = 'mock' | 'test' | 'live';

export interface SubscriptionLinkInput {
  subscriptionId: string;
  orderId: string;
  amountOre: number;
  continueUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  language: 'da' | 'en';
}

export interface RecurringInput {
  subscriptionId: string;
  orderId: string;
  amountOre: number;
  callbackUrl: string;
}

export interface RecurringResult {
  paymentId: string;
  /** true/false when QuickPay answered synchronously, null when the outcome comes by callback. */
  accepted: boolean | null;
}

export interface QuickPayClient {
  readonly mode: QuickPayMode;
  createSubscription(orderId: string, description: string): Promise<{ id: string }>;
  subscriptionLink(input: SubscriptionLinkInput): Promise<{ url: string }>;
  recurring(input: RecurringInput): Promise<RecurringResult>;
  /** Unfinished signups are purged after 24 h; their saved card goes first (PLAN-SIGNUP B1). */
  cancelSubscription(subscriptionId: string): Promise<void>;
}

/** QuickPay order ids: 4–20 alphanumerics. "AG" + 12 random base-36 characters. */
export function newOrderId(): string {
  const bytes = randomBytes(12);
  let out = 'AG';
  for (const b of bytes) out += (b % 36).toString(36);
  return out.toUpperCase();
}

export class QuickPayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'QuickPayError';
  }
}

const API = 'https://api.quickpay.net';

export class HttpQuickPayClient implements QuickPayClient {
  constructor(
    readonly mode: 'test' | 'live',
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = API,
  ) {
    if (!apiKey) throw new Error('QUICKPAY_API_KEY is required');
  }

  private async call<T>(
    method: string,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Accept-Version': 'v10',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${this.apiKey}`).toString('base64')}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!res.ok) {
      // QuickPay error bodies can echo request data; keep only the status.
      throw new QuickPayError(`QuickPay ${method} ${path.split('/')[1]} failed`, res.status);
    }
    return (await res.json()) as T;
  }

  async createSubscription(orderId: string, description: string) {
    const r = await this.call<{ id: number }>('POST', '/subscriptions', {
      order_id: orderId,
      currency: 'DKK',
      description: description.slice(0, 100),
    });
    return { id: String(r.id) };
  }

  async subscriptionLink(i: SubscriptionLinkInput) {
    const r = await this.call<{ url: string }>(
      'PUT',
      `/subscriptions/${encodeURIComponent(i.subscriptionId)}/link`,
      {
        amount: i.amountOre,
        continue_url: i.continueUrl,
        cancel_url: i.cancelUrl,
        callback_url: i.callbackUrl,
        language: i.language,
        // Card only (MobilePay is not offered, PLAN-SIGNUP §4).
        payment_methods: 'creditcard',
      },
    );
    return { url: r.url };
  }

  async cancelSubscription(subscriptionId: string) {
    await this.call(
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel?synchronized`,
      {},
    );
  }

  async recurring(i: RecurringInput) {
    const r = await this.call<{ id: number; accepted: boolean; state: string }>(
      'POST',
      `/subscriptions/${encodeURIComponent(i.subscriptionId)}/recurring?synchronized`,
      { amount: i.amountOre, order_id: i.orderId, auto_capture: true },
      { 'QuickPay-Callback-Url': i.callbackUrl },
    );
    const settled = r.state === 'processed' || r.state === 'rejected';
    return { paymentId: String(r.id), accepted: settled ? r.accepted : null };
  }
}

/**
 * No network: subscriptions are "mock_<order>", the card form is the app's own mock checkout
 * page, and recurring charges succeed at once. With the private key it also sends the signed
 * Payment callback QuickPay would send, through the real ingest verification, because only that
 * callback activates a new company (PLAN-SIGNUP §4.2).
 */
export class MockQuickPayClient implements QuickPayClient {
  readonly mode = 'mock' as const;
  constructor(
    private readonly appUrl: string,
    private readonly privateKey?: string,
  ) {}

  async createSubscription(orderId: string) {
    return { id: `mock_${orderId}` };
  }

  async subscriptionLink(i: SubscriptionLinkInput) {
    const url = new URL('/checkout/mock', this.appUrl);
    url.searchParams.set('subscription', i.subscriptionId);
    url.searchParams.set('order', i.orderId);
    url.searchParams.set('amount', String(i.amountOre));
    url.searchParams.set('continue', i.continueUrl);
    url.searchParams.set('cancel', i.cancelUrl);
    return { url: url.toString() };
  }

  async recurring(i: RecurringInput) {
    const paymentId = `mock_pay_${i.orderId}`;
    const key = this.privateKey;
    if (key) {
      const body = JSON.stringify({
        id: paymentId,
        type: 'Payment',
        order_id: i.orderId,
        accepted: true,
        test_mode: true,
        state: 'processed',
      });
      // After the answer, like QuickPay: the callback arrives separately.
      setTimeout(() => {
        void fetch(i.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CHECKSUM_HEADER]: signCallback(body, key),
          },
          body,
          signal: AbortSignal.timeout(5000),
        }).catch(() => undefined);
      }, 200);
    }
    return { paymentId, accepted: true };
  }

  async cancelSubscription() {}
}

export function quickPayMode(value: string | undefined): QuickPayMode {
  if (value === 'test' || value === 'live') return value;
  if (value === undefined || value === '' || value === 'mock') return 'mock';
  throw new Error(`QUICKPAY_MODE must be mock, test or live`);
}

export function createQuickPay(env: {
  QUICKPAY_MODE?: string | undefined;
  QUICKPAY_API_KEY?: string | undefined;
  /** Mock mode only: signs the Payment callbacks the mock sends. */
  QUICKPAY_PRIVATE_KEY?: string | undefined;
  APP_URL: string;
  NODE_ENV?: string | undefined;
}): QuickPayClient {
  const mode = quickPayMode(env.QUICKPAY_MODE);
  if (mode === 'mock') {
    if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('http://localhost'))
      throw new Error('QUICKPAY_MODE=mock is not allowed in production');
    return new MockQuickPayClient(env.APP_URL, env.QUICKPAY_PRIVATE_KEY);
  }
  return new HttpQuickPayClient(mode, env.QUICKPAY_API_KEY ?? '');
}

/* ---- Callbacks ----------------------------------------------------------------------------------- */

export const CHECKSUM_HEADER = 'quickpay-checksum-sha256';

/** QuickPay signs callbacks with HMAC-SHA256 over the raw body, keyed with the private key. */
export function signCallback(rawBody: string | Buffer, privateKey: string): string {
  return createHmac('sha256', privateKey).update(rawBody).digest('hex');
}

export function verifyCallback(
  rawBody: string | Buffer,
  checksum: string | undefined,
  privateKey: string,
): boolean {
  if (!checksum || !privateKey || !/^[0-9a-f]{64}$/i.test(checksum)) return false;
  const expected = Buffer.from(signCallback(rawBody, privateKey), 'hex');
  const given = Buffer.from(checksum, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const callbackSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  type: z.enum(['Subscription', 'Payment']),
  order_id: z.string().regex(/^[A-Za-z0-9]{4,20}$/),
  accepted: z.boolean(),
  test_mode: z.boolean().optional().default(false),
  state: z.string().max(40).optional(),
  metadata: z
    .object({
      brand: z.string().max(40).nullish(),
      last4: z.string().max(4).nullish(),
      exp_month: z.number().int().min(1).max(12).nullish(),
      exp_year: z.number().int().min(2000).max(2100).nullish(),
    })
    .partial()
    .nullish(),
});

export interface QuickPayCallback {
  id: string;
  type: 'Subscription' | 'Payment';
  orderId: string;
  accepted: boolean;
  testMode: boolean;
  card: { brand: string | null; last4: string | null; expiry: string | null };
}

/** Parses a verified callback body. Test-mode payments are refused in live mode. */
export function parseCallback(rawBody: string, mode: QuickPayMode): QuickPayCallback {
  const p = callbackSchema.parse(JSON.parse(rawBody));
  if (mode === 'live' && p.test_mode) throw new Error('test-mode callback in live mode');
  const m = p.metadata ?? {};
  const expiry =
    m.exp_month && m.exp_year
      ? `${String(m.exp_month).padStart(2, '0')}/${String(m.exp_year).slice(-2)}`
      : null;
  return {
    id: p.id,
    type: p.type,
    orderId: p.order_id,
    accepted: p.accepted,
    testMode: p.test_mode,
    card: { brand: m.brand ?? null, last4: m.last4 ?? null, expiry },
  };
}
