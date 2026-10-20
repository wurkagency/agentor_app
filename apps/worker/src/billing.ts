import {
  newOrderId,
  parseCallback,
  QuickPayError,
  type QuickPayClient,
  type QuickPayMode,
} from '@agentor/billing';
import {
  activateSignupIfPaid,
  applyChargeResult,
  applySubscriptionAuthorized,
  prepareCharge,
  prepareRetry,
  providerSubscriptionFor,
  purgeSignupTenant,
  purgeSignupUsers,
  sendSupportInvoice,
  signupPurgeCandidates,
  type PendingCharge,
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
    const { chargeNow } = await applySubscriptionAuthorized(
      deps.db,
      ref.tenantId,
      ref.refId,
      cb.card,
    );
    deps.log.info({ tenantId: ref.tenantId }, 'subscription card authorised');
    // Signup: the first period is charged at once ("I alt i dag", PLAN-SIGNUP §4.2).
    if (chargeNow) await handleCharge(deps, ref.tenantId);
    return;
  }
  if (cb.type === 'Payment' && ref.kind === 'invoice') {
    await applyChargeResult(deps.db, ref.tenantId, ref.refId, {
      accepted: cb.accepted,
      providerPaymentId: cb.id,
    });
    deps.log.info({ tenantId: ref.tenantId, accepted: cb.accepted }, 'charge result applied');
    // Only a verified Payment callback activates a new company, never the browser's return or
    // the synchronous answer to our own request (PLAN-SIGNUP §4.2). Idempotent.
    if (cb.accepted && (await activateSignupIfPaid(deps.db, ref.tenantId, ref.refId)))
      deps.log.info({ tenantId: ref.tenantId }, 'company activated');
    return;
  }
  deps.log.warn({ type: cb.type, kind: ref.kind }, 'quickpay callback type mismatch');
}

/** Monthly charge for one tenant (scheduler → queue → here). Safe to retry. */
async function handleCharge(deps: BillingDeps, tenantId: string): Promise<void> {
  const charge = await prepareCharge(deps.db, tenantId, newOrderId);
  if (charge) await runCharge(deps, tenantId, charge, 'subscription charged');
}

/** Runs a prepared QuickPay charge and records a synchronous outcome. */
async function runCharge(
  deps: BillingDeps,
  tenantId: string,
  charge: PendingCharge,
  message: string,
): Promise<void> {
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
  deps.log.info({ tenantId, invoice: charge.number, accepted: result.accepted }, message);
}

/**
 * Unfinished signups are deleted 24 hours after they started (PLAN-SIGNUP B1): the saved card at
 * QuickPay is cancelled first, then the company and finally accounts left without one. A payment
 * in flight in the last hour waits for the next run. Counts only in the log, no personal data.
 */
async function purgeSignups(deps: BillingDeps): Promise<void> {
  let tenants = 0;
  for (const tenantId of await signupPurgeCandidates(deps.db)) {
    const sub = await providerSubscriptionFor(deps.db, tenantId);
    if (sub) {
      try {
        await deps.quickpay.cancelSubscription(sub);
      } catch (e) {
        // Already cancelled or never authorised: nothing is saved at QuickPay to keep.
        if (!(e instanceof QuickPayError && e.status >= 400 && e.status < 500)) {
          deps.log.warn({ tenantId }, 'signup purge: QuickPay cancel failed, retried next run');
          continue;
        }
      }
    }
    if (await purgeSignupTenant(deps.db, tenantId)) tenants++;
  }
  const users = await purgeSignupUsers(deps.db);
  if (tenants || users) deps.log.info({ tenants, users }, 'unfinished signups purged');
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
    case 'billing.send-invoice': {
      const { tenantId, invoiceId } = parseBillingJob('billing.send-invoice', data);
      const charge = await sendSupportInvoice(deps.db, tenantId, invoiceId, newOrderId);
      if (charge) await runCharge(deps, tenantId, charge, 'support invoice charged');
      else deps.log.info({ tenantId }, 'support invoice sent');
      return;
    }
    case 'billing.retry': {
      const { tenantId, invoiceId } = parseBillingJob('billing.retry', data);
      const charge = await prepareRetry(deps.db, tenantId, invoiceId, newOrderId);
      if (charge) await runCharge(deps, tenantId, charge, 'charge retried');
      return;
    }
    case 'signup.purge':
      return purgeSignups(deps);
    default:
      throw new Error(`unknown billing job ${name}`);
  }
}
