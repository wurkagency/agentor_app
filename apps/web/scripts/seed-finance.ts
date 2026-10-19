import { copenhagenMonth, copenhagenTime } from '@agentor/core';
import type pg from 'pg';
import { PLATFORM_TENANTS, TENANTS } from './seed-data';

/**
 * Finans (M9, F1–F7): fictional subscription details and 12 months of invoices for the seeded
 * customers, so every Finans page has history. Numbers come from the real invoice sequence.
 * Monthly prices: Startup 79, Business 159, Enterprise 299 kr.; a year costs 10 months.
 */

type Method = 'card' | 'mobilepay' | 'invoice';
interface Profile {
  interval: 'month' | 'year';
  method: Method;
  card?: [brand: string, last4: string, expiry: string];
  ean?: string;
  /** Months since the current yearly period started. */
  yearStartedMonthsAgo?: number;
  cancelInDays?: number;
  trialDaysLeft?: number;
  /** The latest subscription charge failed this many times. */
  failedAttempts?: number;
  /** Paid support invoices for these months back (1 = last month): [months back, minutes]. */
  support?: [number, number][];
  /** The last support invoice is unpaid and overdue, paid by bank transfer. */
  supportOverdue?: boolean;
  billingEmail: string;
}

const P = PLATFORM_TENANTS;
const PROFILES: Record<string, Profile> = {
  [TENANTS.nordlys.id]: {
    interval: 'month',
    method: 'card',
    support: [
      [1, 225],
      [2, 135],
      [4, 30],
    ],
    billingEmail: 'bogholderi@nordlys-cykler.dk',
  },
  [TENANTS.outlet.id]: {
    interval: 'month',
    method: 'card',
    billingEmail: 'mette@nordlys-cykler.dk',
  },
  [P.molle.id]: {
    interval: 'month',
    method: 'card',
    card: ['mastercard', '0019', '04/28'],
    failedAttempts: 2,
    support: [[1, 195]],
    billingEmail: 'regnskab@molle-sport.test',
  },
  [P.hav.id]: {
    interval: 'month',
    method: 'card',
    card: ['visa', '1881', '09/27'],
    support: [[1, 150]],
    supportOverdue: true,
    billingEmail: 'faktura@hav-hudpleje.test',
  },
  [P.bjerg.id]: {
    interval: 'year',
    method: 'invoice',
    ean: '5790001234567',
    yearStartedMonthsAgo: 11,
    support: [
      [1, 600],
      [2, 420],
      [3, 240],
    ],
    billingEmail: 'kreditor@bjerg-byg.test',
  },
  [P.kvist.id]: {
    interval: 'year',
    method: 'card',
    card: ['visa', '7731', '02/29'],
    yearStartedMonthsAgo: 11,
    cancelInDays: 16,
    billingEmail: 'okonomi@kvist-mobler.test',
  },
  [P.fjord.id]: {
    interval: 'month',
    method: 'card',
    card: ['visa', '5520', '__EXPIRING__'],
    billingEmail: 'hej@fjordkaffe.test',
  },
  [P.osterbro.id]: {
    interval: 'month',
    method: 'mobilepay',
    billingEmail: 'vin@osterbro-vin.test',
  },
  [P.lyngby.id]: {
    interval: 'month',
    method: 'card',
    trialDaysLeft: 8,
    billingEmail: 'leg@lyngby-legetoj.test',
  },
};

const PRICE: Record<string, number> = { startup: 7900, business: 15900, enterprise: 29900 };
const RATE = 64_000;
const DAY = 86_400_000;

const roundQuarter = (m: number) => Math.ceil(m / 15) * 15;

export async function seedFinance(
  owner: pg.Client,
  inTenant: (id: string, fn: () => Promise<void>) => Promise<void>,
) {
  const now = new Date();
  // Month starts in Copenhagen time, like the app's billing months.
  const cur = copenhagenMonth(now);
  const monthStart = (back: number) => {
    const n = cur.year * 12 + cur.month - 1 - back;
    return copenhagenTime(Math.floor(n / 12), (n % 12) + 1, 1);
  };
  const expiring = (() => {
    const d = new Date(now);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
  })();
  // Platform settings for Finans: the default rate and a fictional bookkeeper (F7).
  for (const [key, value] of [
    ['hourlyRateOre', RATE],
    ['bookkeeperEmail', 'bogholder@agentor.test'],
  ] as const)
    await owner.query(
      `insert into platform.settings (key, value, updated_by_name) values ($1, $2, 'Seed')
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  const number = async () =>
    (await owner.query<{ n: string }>(`select app.next_invoice_number() as n`)).rows[0]!.n;

  for (const [tenantId, p] of Object.entries(PROFILES)) {
    await inTenant(tenantId, async () => {
      const sub = (
        await owner.query<{ plan_id: string }>(`select plan_id from subscriptions limit 1`)
      ).rows[0];
      if (!sub) return;
      const monthly = PRICE[sub.plan_id] ?? 0;
      const card = p.card
        ? [p.card[0], p.card[1], p.card[2] === '__EXPIRING__' ? expiring : p.card[2]]
        : null;
      const trialEnd = p.trialDaysLeft ? new Date(now.getTime() + p.trialDaysLeft * DAY) : null;
      // Current period and the invoice history behind it.
      let periodStart: Date;
      let periodEnd: Date;
      if (p.interval === 'year') {
        periodStart = monthStart(p.yearStartedMonthsAgo ?? 0);
        periodEnd = monthStart((p.yearStartedMonthsAgo ?? 0) - 12);
        // Bjerg renews within two weeks on the board: end the period mid next month.
        periodEnd = new Date(Math.min(periodEnd.getTime(), now.getTime() + 13 * DAY));
      } else {
        periodStart = monthStart(0);
        periodEnd = monthStart(-1);
      }
      // Nordlys and Outlet keep the subscriptions seed.ts gives them (the M4 billing tests use them).
      if (tenantId !== TENANTS.nordlys.id && tenantId !== TENANTS.outlet.id) {
        await owner.query(
          `update subscriptions set interval = $1, payment_method = $2, ean = $3,
             card_brand = coalesce($4, card_brand), card_last4 = coalesce($5, card_last4), card_expiry = coalesce($6, card_expiry),
             provider_subscription_id = case when $2 = 'invoice' or $9::timestamptz is not null then null else provider_subscription_id end,
             current_period_start = $7, current_period_end = $8, trial_ends_at = $9, cancel_at = $10,
             status = $11`,
          [
            p.interval,
            p.method,
            p.ean ?? null,
            card?.[0] ?? null,
            card?.[1] ?? null,
            card?.[2] ?? null,
            trialEnd ? monthStart(0) : periodStart,
            trialEnd ?? periodEnd,
            trialEnd,
            p.cancelInDays ? new Date(now.getTime() + p.cancelInDays * DAY) : null,
            p.failedAttempts ? 'past_due' : 'active',
          ],
        );
      }
      await owner.query(`update tenants set billing_email = $1 where id = $2`, [
        p.billingEmail,
        tenantId,
      ]);
      if (tenantId === TENANTS.nordlys.id) {
        // Nordlys already has its subscription invoices (seed.ts); add its support history.
      } else if (trialEnd) {
        // Trial: nothing invoiced yet.
      } else if (p.interval === 'year') {
        await owner.query(
          `insert into invoices (tenant_id, number, kind, period_start, period_end, description, amount_ore, vat_ore,
             status, paid_at, payment_method, issued_at, due_at)
           values ($1, $2, 'subscription', $3, $4, $5, $6, $7, 'paid', $8, $9, $3, $10)`,
          [
            tenantId,
            await number(),
            periodStart,
            periodEnd,
            `${sub.plan_id[0]!.toUpperCase()}${sub.plan_id.slice(1)} · årlig`,
            monthly * 10,
            monthly * 10 * 0.25,
            new Date(periodStart.getTime() + (p.method === 'invoice' ? 6 : 0) * DAY),
            p.method,
            new Date(periodStart.getTime() + (p.method === 'invoice' ? 8 : 0) * DAY),
          ],
        );
      } else {
        const months = tenantId === TENANTS.outlet.id ? 0 : 12;
        for (let back = months - 1; back >= 0; back--) {
          const start = monthStart(back);
          const failed = back === 0 && p.failedAttempts;
          await owner.query(
            `insert into invoices (tenant_id, number, kind, period_start, period_end, description, amount_ore, vat_ore,
               status, paid_at, payment_method, issued_at, due_at, attempts, next_retry_at)
             values ($1, $2, 'subscription', $3, $4, $5, $6, $7, $8, $9, $10, $3, $3, $11, $12)`,
            [
              tenantId,
              await number(),
              start,
              monthStart(back - 1),
              `${sub.plan_id[0]!.toUpperCase()}${sub.plan_id.slice(1)} · månedlig`,
              monthly,
              monthly * 0.25,
              failed ? 'failed' : 'paid',
              failed ? null : start,
              p.method,
              failed ? p.failedAttempts : 1,
              failed ? new Date(now.getTime() + 2 * DAY) : null,
            ],
          );
        }
      }
      // Support invoices, billed the 1st after the month of work.
      for (const [i, [back, minutes]] of (p.support ?? []).entries()) {
        const workStart = monthStart(back);
        const issued = new Date(monthStart(back - 1).getTime() + 7 * 3_600_000);
        const billed = roundQuarter(minutes) + 15;
        const net = Math.round((billed / 60) * RATE);
        const overdue = p.supportOverdue && i === 0;
        await owner.query(
          `insert into invoices (tenant_id, number, kind, period_start, period_end, description, lines, amount_ore, vat_ore,
             status, paid_at, payment_method, issued_at, due_at, approved_at, approved_by_name)
           values ($1, $2, 'support', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, 'Kasper Nyborg')`,
          [
            tenantId,
            await number(),
            workStart,
            monthStart(back - 1),
            `Support · ${new Intl.DateTimeFormat('da-DK', { month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' }).format(workStart)}`,
            JSON.stringify([
              {
                text: 'Supportsager',
                amountOre: net,
                registeredMinutes: minutes,
                billedMinutes: billed,
                rateOre: RATE,
              },
            ]),
            net,
            net * 0.25,
            overdue ? 'open' : 'paid',
            overdue ? null : new Date(issued.getTime() + (p.method === 'invoice' ? 13 : 0) * DAY),
            overdue || p.method === 'invoice' ? 'invoice' : p.method,
            issued,
            new Date(issued.getTime() + (overdue || p.method === 'invoice' ? 8 : 0) * DAY),
          ],
        );
      }
    });
  }
}
