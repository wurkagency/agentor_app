'use server';

import { CHECKSUM_HEADER, signCallback } from '@agentor/billing';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/server/auth/session';
import { env } from '@/server/env';
import { sameOriginPath } from '@/server/same-origin';

const schema = z.object({
  subscription: z.string().regex(/^mock_[A-Za-z0-9]{4,20}$/),
  order: z.string().regex(/^[A-Za-z0-9]{4,20}$/),
  continueUrl: z.string(),
  cancelUrl: z.string(),
  outcome: z.enum(['accept', 'decline']),
});

/**
 * Sends what QuickPay would send after the card form: a signed Subscription callback to
 * agentor-ingest. The order id decides the tenant on the worker side, exactly as in production.
 */
export async function submitMockCard(input: unknown): Promise<{ ok: false; error: string }> {
  const e = env();
  if (e.QUICKPAY_MODE !== 'mock' || !e.QUICKPAY_PRIVATE_KEY) return { ok: false, error: 'mock' };
  await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { subscription, order, continueUrl, cancelUrl, outcome } = parsed.data;
  const body = JSON.stringify({
    id: subscription,
    type: 'Subscription',
    order_id: order,
    accepted: outcome === 'accept',
    test_mode: true,
    state: outcome === 'accept' ? 'active' : 'rejected',
    metadata: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 },
  });
  const res = await fetch(new URL('/billing/quickpay', e.INGEST_INTERNAL_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CHECKSUM_HEADER]: signCallback(body, e.QUICKPAY_PRIVATE_KEY),
    },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res || res.status !== 202) return { ok: false, error: 'ingest' };
  redirect(sameOriginPath(outcome === 'accept' ? continueUrl : cancelUrl));
}
