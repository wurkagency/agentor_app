import {
  newOrderId,
  parseCallback,
  QuickPayError,
  type QuickPayClient,
  type QuickPayMode,
} from '@agentor/billing';
import {
  applyChargeResult,
  applySubscriptionAuthorized,
  prepareCharge,
  resolveBillingRef,
  type Database,
} from '@agentor/db';
import { parseBillingJob, type BillingJobName } from '@agentor/jobs';
import type { Logger } from 'pino';

export interface BillingDeps {
  db: Database;
  quickpay: QuickPayClient;
  mode: QuickPayMode;
  /** Public URL of agentor-ingest's /billing/quickpay, given to QuickPay for callbacks. */
  callbackUrl: string;
  log: Logger;
}

/**
 * Applies a verified QuickPay callback. Everything that matters is looked up from our own
 * records: the order id resolves the tenant and the object, the body only says what happened.
 */
async function handleCallback(deps: BillingDeps, body: string): Promise<void> {
  const cb = parseCallback(body, deps.mode);
  const ref = await resolveBillingRef(deps.db, cb.orderId);
  if (!ref) {
    // Unknown order: not ours, or registered in another environment. Retrying won't help.
    deps.log.warn({ type: cb.type }, 'quickpay callback for unknown order');
    return;
  }
  if (cb.type === 'Subscription' && ref.kind === 'subscription') {
    if (!cb.accepted) {
      deps.log.info({ tenantId: ref.tenantId }, 'card authorisation not accepted');
      return;
    }
    await applySubscriptionAuthorized(deps.db, ref.tenantId, ref.refId, cb.card);
    deps.log.info({ tenantId: ref.tenantId }, 'subscription card authorised');
    return;
  }
  if (cb.type === 'Payment' && ref.kind === 'invoice') {
    await applyChargeResult(deps.db, ref.tenantId, ref.refId, {
      accepted: cb.accepted,
      providerPaymentId: cb.id,
    });
    deps.log.info({ tenantId: ref.tenantId, accepted: cb.accepted }, 'charge result applied');
    return;
  }
  deps.log.warn({ type: cb.type, kind: ref.kind }, 'quickpay callback type mismatch');
}

/** Monthly charge for one tenant (scheduler → queue → here). Safe to retry. */
async function handleCharge(deps: BillingDeps, tenantId: string): Promise<void> {
  const charge = await prepareCharge(deps.db, tenantId, newOrderId);
  if (!charge) return;
  let result;
  try {
    result = await deps.quickpay.recurring({
      subscriptionId: charge.providerSubscriptionId,
      orderId: charge.orderId,
      amountOre: charge.amountOre,
      callbackUrl: deps.callbackUrl,
    });
  } catch (e) {
    // A resumed charge whose order QuickPay already has: the outcome arrives by callback.
    if (charge.resumed && e instanceof QuickPayError && e.status >= 400 && e.status < 500) {
      deps.log.info({ tenantId, invoice: charge.number }, 'charge already submitted');
      return;
    }
    throw e;
  }
  if (result.accepted !== null) {
    await applyChargeResult(deps.db, tenantId, charge.invoiceId, {
      accepted: result.accepted,
      providerPaymentId: result.paymentId,
    });
  }
  deps.log.info(
    { tenantId, invoice: charge.number, accepted: result.accepted },
    'subscription charged',
  );
}

export async function processBillingJob(
  deps: BillingDeps,
  name: string,
  data: unknown,
): Promise<void> {
  switch (name as BillingJobName) {
    case 'quickpay.callback':
      return handleCallback(deps, parseBillingJob('quickpay.callback', data).body);
    case 'billing.charge':
      return handleCharge(deps, parseBillingJob('billing.charge', data).tenantId);
    default:
      throw new Error(`unknown billing job ${name}`);
  }
}
