'use server';

import { copenhagenMonth, supportMonth, withVat } from '@agentor/core';
import {
  PlatformError,
  createPlanVersion,
  createSupportVersion,
  financeSubscriptions,
  listPlans,
  listSupportVersions,
  markPriceNoticeSent,
  NON_BILLABLE_REASONS,
  type PlanValueKey,
} from '@agentor/db';
import { formatDate, formatMoney } from '@agentor/i18n';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/server/actor';
import { db } from '@/server/infra';
import { sendMail } from '@/server/mail';
import { requireStaff } from '@/server/platform';

/** The features Superadmin switches per plan on A2 (data in plan_entitlements.features). */
export type ProductFeature =
  'moreDestinations' | 'externalUsers' | 'sso' | 'whiteLabel' | 'supportAudit' | 'eanInvoice';

const FEATURES = [
  'moreDestinations',
  'externalUsers',
  'sso',
  'whiteLabel',
  'supportAudit',
  'eanInvoice',
] as const;

const limit = z.number().int().min(0).max(100_000_000).nullable();

const schema = z.object({
  support: z.object({
    rateInclKr: z.number().min(0).max(100_000),
    roundingMinutes: z.union([
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ]),
    nonBillable: z.array(z.enum(NON_BILLABLE_REASONS)),
  }),
  plans: z
    .array(
      z.object({
        planId: z.enum(['startup', 'business', 'enterprise']),
        priceKr: z.number().min(0).max(100_000),
        transactionsPerMonth: limit,
        seats: limit,
        features: z.record(z.enum(FEATURES), z.boolean()),
      }),
    )
    .max(3),
  appliesTo: z.enum(['new', 'all_from_renewal']),
});

export type ProductInput = z.infer<typeof schema>;

/**
 * A2 "Gem ændringer": a changed support price becomes a new support price version from the next
 * billing period; each changed plan becomes a new plan price version. With "Alle fra næste
 * fornyelse" the customers on a plan whose price changed get an e-mail now and move to the new
 * price at their first renewal at least 30 days later. Everything is in the platform audit log.
 */
export async function saveProductAction(
  input: ProductInput,
): Promise<ActionResult<{ plans: number; support: boolean; notices: number }>> {
  const { actor } = await requireStaff(true);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;
  const t = await getTranslations('platform.product');
  try {
    const [plans, supportVersions] = await Promise.all([
      listPlans(db()),
      listSupportVersions(db(), actor),
    ]);
    // Support price: the rate is stored ex. VAT; the board edits it incl. VAT.
    const rateOre = Math.round((d.support.rateInclKr * 100) / 1.25);
    const current = supportVersions[0];
    let support = false;
    if (
      !current ||
      current.rateOre !== rateOre ||
      current.roundingMinutes !== d.support.roundingMinutes ||
      [...current.nonBillable].sort().join() !== [...d.support.nonBillable].sort().join()
    ) {
      const now = copenhagenMonth(new Date());
      const next =
        now.month === 12 ? supportMonth(now.year + 1, 1) : supportMonth(now.year, now.month + 1);
      await createSupportVersion(db(), actor, {
        rateOre,
        roundingMinutes: d.support.roundingMinutes,
        nonBillable: d.support.nonBillable,
        effectiveFrom: next.start,
      });
      support = true;
    }

    let changed = 0;
    let notices = 0;
    for (const p of d.plans) {
      const plan = plans.find((x) => x.id === p.planId);
      if (!plan) return { ok: false, error: 'NOT_FOUND' };
      const priceOre = Math.round(p.priceKr * 100);
      const e = plan.entitlements;
      const included = new Set(e.features.included);
      const excluded = new Set(e.features.excluded);
      let featuresChanged = false;
      for (const f of FEATURES) {
        const on = p.features[f];
        if (on === undefined || on === included.has(f)) continue;
        featuresChanged = true;
        if (on) {
          included.add(f);
          excluded.delete(f);
        } else {
          included.delete(f);
          excluded.add(f);
        }
      }
      const values: Partial<Record<PlanValueKey, unknown>> = {};
      if (p.transactionsPerMonth !== e.transactionsPerMonth)
        values.transactions_per_month = p.transactionsPerMonth;
      if (p.seats !== e.seats) values.seats = p.seats;
      if (featuresChanged) {
        values.features = { included: [...included], excluded: [...excluded] };
        // "Flere end 3 destinationer" is the limit itself, not only a line on the cards.
        if (p.features.moreDestinations !== undefined)
          values.destinations_per_flow = p.features.moreDestinations ? null : 3;
      }
      const priceChanged = priceOre !== plan.priceMonthlyOre;
      if (!priceChanged && Object.keys(values).length === 0) continue;
      const versionId = await createPlanVersion(db(), actor, {
        planId: p.planId,
        priceMonthlyOre: priceOre,
        values,
        appliesTo: d.appliesTo,
      });
      changed += 1;
      if (d.appliesTo === 'all_from_renewal' && priceChanged) {
        notices += await sendPriceNotices(
          actor,
          plan.name,
          p.planId,
          plan.priceMonthlyOre,
          priceOre,
          t,
        );
        await markPriceNoticeSent(db(), actor, versionId, notices);
      }
    }
    revalidatePath('/', 'layout');
    return { ok: true, data: { plans: changed, support, notices } };
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.code };
    throw e;
  }
}

/** "Kunderne får besked på e-mail, før prisen ændres": one e-mail per live subscription. */
async function sendPriceNotices(
  actor: Awaited<ReturnType<typeof requireStaff>>['actor'],
  planName: string,
  planId: string,
  oldOre: number,
  newOre: number,
  t: Awaited<ReturnType<typeof getTranslations<'platform.product'>>>,
): Promise<number> {
  const subs = (await financeSubscriptions(db(), actor)).filter(
    (s) =>
      s.planId === planId &&
      (s.status === 'active' || s.status === 'past_due') &&
      !s.cancelAt &&
      s.billingEmail,
  );
  const from = new Date(Date.now() + 30 * 86_400_000);
  for (const s of subs) {
    const price = (ore: number) => formatMoney(withVat(ore).gross / 100, 'da');
    await sendMail({
      to: s.billingEmail!,
      subject: t('noticeSubject', { plan: planName }),
      text: t('noticeBody', {
        company: s.tenantName,
        plan: planName,
        old: price(oldOre),
        new: price(newOre),
        date: formatDate(from, 'da'),
      }),
    });
  }
  return subs.length;
}
