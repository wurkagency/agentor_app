import { createQuickPay, newOrderId, type QuickPayClient } from '@agentor/billing';
import { withVat } from '@agentor/core';
import {
  attachPaymentSubscription,
  getPaymentSubscription,
  listPlans,
  type Actor,
} from '@agentor/db';
import { actorFor } from './actor';
import type { AppContext } from './auth/session';
import { env } from './env';
import { db } from './infra';

let client: QuickPayClient | undefined;

export function quickpay(): QuickPayClient {
  const e = env();
  client ??= createQuickPay({
    QUICKPAY_MODE: e.QUICKPAY_MODE,
    QUICKPAY_API_KEY: e.QUICKPAY_API_KEY,
    APP_URL: e.APP_URL,
    NODE_ENV: e.NODE_ENV,
  });
  return client;
}

/**
 * Starts adding (or changing) the card: creates the QuickPay subscription on first use,
 * registers a fresh order id for this tenant and returns QuickPay's card form URL. The
 * callback goes to agentor-ingest; nothing here trusts the browser's return to the app.
 */
export async function startCardSetup(
  ctx: AppContext,
  paths: { continuePath: string; cancelPath: string },
): Promise<string> {
  return startCardSetupFor(
    { actor: await actorFor(ctx), tenantName: ctx.tenant.tenantName, locale: ctx.user.locale },
    paths,
  );
}

/**
 * The same for a company in signup, which has no app context yet (PLAN-SIGNUP §4.2). The card
 * form shows the first period's total ("I alt i dag"), which is charged as soon as the card is
 * authorised.
 */
export async function startCardSetupFor(
  who: { actor: Actor; tenantName: string; locale: 'da' | 'en' },
  paths: { continuePath: string; cancelPath: string },
  amountOre?: number,
): Promise<string> {
  const e = env();
  const sub = await getPaymentSubscription(db(), who.actor);
  if (!sub) throw new Error('NO_SUBSCRIPTION');
  const plan = (await listPlans(db())).find((p) => p.id === sub.planId);
  const orderId = newOrderId();
  const qp = quickpay();
  const providerId =
    sub.providerSubscriptionId ??
    (await qp.createSubscription(orderId, `Agentor ${plan?.name ?? ''} · ${who.tenantName}`)).id;
  await attachPaymentSubscription(db(), who.actor, orderId, providerId);
  const { url } = await qp.subscriptionLink({
    subscriptionId: providerId,
    orderId,
    amountOre: amountOre ?? withVat(plan?.priceMonthlyOre ?? 0).gross,
    continueUrl: new URL(paths.continuePath, e.APP_URL).toString(),
    cancelUrl: new URL(paths.cancelPath, e.APP_URL).toString(),
    callbackUrl: new URL('/billing/quickpay', e.INGEST_PUBLIC_URL).toString(),
    language: who.locale,
  });
  return url;
}
