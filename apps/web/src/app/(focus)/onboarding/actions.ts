'use server';

import {
  changePlan,
  completeOnboarding,
  createCompany,
  getBillingOverview,
  OnboardingError,
  setSessionTenant,
} from '@agentor/db';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole, requireUser } from '@/server/auth/session';
import { startCardSetup } from '@/server/billing';
import { CVR_RE, cvrProvider, type CvrCompany } from '@/server/cvr';
import { db } from '@/server/infra';
import { ORDERS_PER_MONTH, TEMPLATES } from './options';

export async function lookupCvr(cvr: string): Promise<ActionResult<CvrCompany>> {
  await requireUser();
  const clean = cvr.replace(/\s/g, '');
  if (!CVR_RE.test(clean)) return { ok: false, error: 'cvrFormat' };
  try {
    const company = await cvrProvider().lookup(clean);
    if (!company) return { ok: false, error: 'cvrNotFound' };
    return { ok: true, data: company };
  } catch (e) {
    console.error('cvr lookup failed', e instanceof Error ? e.message : e);
    return { ok: false, error: 'cvrUnavailable' };
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s));

const companySchema = z.object({
  name: z.string().trim().min(2).max(160),
  cvr: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || CVR_RE.test(s), 'cvrFormat')
    .transform((s) => (s === '' ? null : s)),
  addressLine: optional(160),
  postalCode: optional(10),
  city: optional(80),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => s === '' || z.email().safeParse(s).success, 'email')
    .transform((s) => (s === '' ? null : s)),
  smsPhone: z
    .string()
    .trim()
    .refine((s) => s === '' || /^\+?[0-9 ]{8,16}$/.test(s), 'phone')
    .transform((s) => (s === '' ? null : s.replace(/\s/g, ''))),
  ordersPerMonth: z.enum(ORDERS_PER_MONTH).nullable(),
  locale: z.enum(['da', 'en']),
});

/** Step 1: create the company, make it the session's tenant, go on to plan and payment. */
export async function createCompanyStep(input: unknown): Promise<ActionResult> {
  const s = await requireUser();
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  try {
    const tenantId = await createCompany(db(), s.user.id, {
      ...parsed.data,
      timeZone: 'Europe/Copenhagen',
    });
    await setSessionTenant(db(), s.sessionId, tenantId);
  } catch (e) {
    if (e instanceof OnboardingError) return { ok: false, error: e.code };
    throw e;
  }
  redirect('/onboarding/plan');
}

const planSchema = z.enum(['startup', 'business', 'enterprise']);

async function selectPlan(planId: string) {
  const ctx = await requireRole(['owner']);
  const plan = planSchema.parse(planId);
  const overview = await getBillingOverview(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
  });
  if (overview && overview.plan.id !== plan) await changePlan(db(), await actorFor(ctx), plan);
  return ctx;
}

/** Step 2: save the chosen plan and send the owner to the card form. */
export async function addCardStep(planId: string): Promise<ActionResult<{ url: string }>> {
  const ctx = await selectPlan(planId);
  const url = await startCardSetup(ctx, {
    continuePath: '/onboarding/plan?card=return',
    cancelPath: '/onboarding/plan?card=cancelled',
  });
  return { ok: true, data: { url } };
}

export async function continuePlanStep(planId: string): Promise<ActionResult> {
  const ctx = await selectPlan(planId);
  const overview = await getBillingOverview(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.user.id,
  });
  if (!overview?.subscription.hasCard) return { ok: false, error: 'cardRequired' };
  redirect('/onboarding/flow');
}

/** Step 3: template chosen (opened in the editor once flows exist) or skipped. */
export async function finishOnboarding(template: string | null): Promise<void> {
  const ctx = await requireRole(['owner']);
  const chosen = template && (TEMPLATES as readonly string[]).includes(template) ? template : null;
  await completeOnboarding(db(), await actorFor(ctx), chosen);
  redirect(chosen ? `/integrations?template=${chosen}` : '/');
}
