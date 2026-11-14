/**
 * SEED_SCENARIO=signup (PLAN-SIGNUP S4): one fictional owner in each signup state, made through
 * the same repo functions and database role as the signup pages, so RLS and the state guard apply.
 * Activation is the one step done as the table owner: in the app only a verified QuickPay callback
 * can activate, and the seed has no payment.
 */
import type pg from 'pg';
import { SIGNUP_USERS } from './seed-data';

type InTenant = (id: string, fn: () => Promise<void>) => Promise<void>;

export async function seedSignup(owner: pg.Client, inTenant: InTenant) {
  const {
    chooseSignupPlan,
    createDatabase,
    createSignupCompany,
    markSignupStarted,
    skipOnboarding,
  } = await import('@agentor/db');
  const url = process.env.DATABASE_URL_WEB;
  if (!url) throw new Error('DATABASE_URL_WEB missing');
  const app = createDatabase(url, { max: 2, applicationName: 'agentor-seed' });
  try {
    const { konto, betaling, onboarding } = SIGNUP_USERS;
    for (const u of [konto, betaling, onboarding]) await markSignupStarted(app.db, u.id);

    // SU5: company and plan chosen, waiting for the card.
    const pending = await createSignupCompany(app.db, betaling.id, betaling.email, {
      name: 'Nordlys Cykler Odense ApS',
      cvr: null,
      addressLine: 'Vestergade 12',
      postalCode: '5000',
      city: 'Odense C',
      ordersPerMonth: '100-1000',
      chosenConnectors: ['woocommerce', 'dinero'],
      locale: 'da',
    });
    await chooseSignupPlan(
      app.db,
      { tenantId: pending, userId: betaling.id, name: betaling.name },
      'business',
      'year',
    );

    // Active, onboarding skipped at OB1: Overblik shows the reminder.
    const active = await createSignupCompany(app.db, onboarding.id, onboarding.email, {
      name: 'Nordlys Cykler Aalborg ApS',
      cvr: null,
      addressLine: 'Boulevarden 3',
      postalCode: '9000',
      city: 'Aalborg',
      ordersPerMonth: 'lt100',
      chosenConnectors: ['shopify', 'economic', 'hubspot'],
      locale: 'da',
    });
    const actor = { tenantId: active, userId: onboarding.id, name: onboarding.name };
    await chooseSignupPlan(app.db, actor, 'business', 'month');
    await inTenant(active, async () => {
      await owner.query(
        `update subscriptions set status = 'active', provider_subscription_id = 'mock_AGSEEDSIGNUP',
           current_period_start = now(), current_period_end = now() + interval '1 month'
         where tenant_id = $1`,
        [active],
      );
      await owner.query(
        `update tenants set signup_state = 'active', signup_state_at = now(), onboarding_step = 'webshop'
         where id = $1`,
        [active],
      );
      await owner.query(`delete from app.pending_signups where tenant_id = $1`, [active]);
    });
    await owner.query(`update auth.users set signup_started_at = null where id = $1`, [
      onboarding.id,
    ]);
    await skipOnboarding(app.db, actor);
  } finally {
    await app.close();
  }
}
