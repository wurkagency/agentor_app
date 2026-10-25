'use server';

import { manifestFor } from '@agentor/connectors';
import { nextOnboardingStep, SIGNUP_PATHS, type OnboardingStep } from '@agentor/core';
import {
  advanceOnboarding,
  createFlow,
  getOnboardingState,
  getRun,
  isUuid,
  listLookups,
  markFirstTestRun,
  openDraft,
  publishDraft,
  requestRun,
  resumeOnboarding,
  saveDraft,
  setOnboardingFlow,
  skipOnboarding,
  type Actor,
} from '@agentor/db';
import {
  diffDefinitions,
  hasErrors,
  parseDefinition,
  validateDefinition,
  type FlowDefinition,
} from '@agentor/flows';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientIp, type ActionResult } from '@/server/actor';
import { templateById } from '@/components/editor/templates';
import { connectionMap } from '@/server/flows';
import { db } from '@/server/infra';
import { enqueueRun } from '@/server/runs';
import { getSignupContext, requireSignupStep } from '@/server/signup';

/**
 * Onboarding after payment (PLAN-SIGNUP S3, OB1–OB5 / MO1–MO5). Built on the existing pieces:
 * connections (B11 start/callback), templates, the dry-run test run and publishing.
 */

async function owner(step: OnboardingStep) {
  const ctx = await requireSignupStep(step);
  const s = ctx.session!;
  const actor: Actor = {
    tenantId: ctx.tenant!.tenantId,
    userId: s.user.id,
    name: s.user.name,
    ip: await clientIp(),
  };
  return { ctx, actor };
}

/* ---- OB1/OB2: connection status (polled while a connection is being tested) -------------------- */

export interface OnboardingConnection {
  id: string;
  connectorId: string;
  category: string;
  name: string;
  status: 'checking' | 'ok' | 'broken';
  /** Chart of accounts fetched (OB2/OB3 "kontoplan hentet"). */
  accounts: boolean;
  /** Orders, customers and products found by the connection test, where it can count. */
  counts: Partial<Record<string, number>> | null;
}

export async function onboardingConnections(): Promise<ActionResult<OnboardingConnection[]>> {
  const ctx = await getSignupContext();
  if (!ctx.session || ctx.tenant?.signupState !== 'active')
    return { ok: false, error: 'forbidden' };
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.session.user.id };
  const [conns, lookups] = await Promise.all([
    connectionMap(c.tenantId, c.userId),
    listLookups(db(), c),
  ]);
  return {
    ok: true,
    data: [...conns.values()].map((x) => ({
      id: x.id,
      connectorId: x.connectorId,
      category: manifestFor(x.connectorId)?.category ?? 'other',
      name: x.name,
      status: x.status as OnboardingConnection['status'],
      accounts: !!lookups[x.id]?.accounts?.length,
      counts: x.recordCounts ?? null,
    })),
  };
}

/** "Fortsæt" after a step: progress moves on (never back) and the next step opens. */
export async function continueOnboarding(step: OnboardingStep): Promise<void> {
  const { actor } = await owner(step);
  const next = nextOnboardingStep(step);
  await advanceOnboarding(db(), actor, next);
  redirect(SIGNUP_PATHS[next]);
}

/** "Spring over": Overblik with a reminder until onboarding is done. */
export async function skipOnboardingAction(step: OnboardingStep): Promise<void> {
  const { actor } = await owner(step);
  await skipOnboarding(db(), actor);
  redirect('/');
}

/** The reminder card on Overblik: back to where onboarding stopped. */
export async function resumeOnboardingAction(): Promise<void> {
  const ctx = await getSignupContext();
  if (!ctx.session || !ctx.tenant || ctx.tenant.role !== 'owner') redirect('/');
  await resumeOnboarding(db(), {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.session.user.id,
    name: ctx.session.user.name,
  });
  redirect(SIGNUP_PATHS[ctx.tenant.onboardingStep ?? 'webshop']);
}

/* ---- OB3: first flow from a template, as a draft, then the test run ---------------------------- */

const templateSchema = z.object({
  templateId: z.string().max(60),
  invoiceMode: z.enum(['draft', 'live']),
});

/**
 * "Brug skabelonen og testkør": places the template on the company's own connections, fills in
 * the accounts the template suggests (by the destination's account names), saves it as a draft
 * flow with every route in Test, and starts a test run on the latest 10 records. Nothing is
 * written anywhere until the owner goes live.
 */
export async function createOnboardingFlow(input: unknown): Promise<ActionResult> {
  const { ctx, actor } = await owner('template');
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const tpl = templateById(parsed.data.templateId);
  if (!tpl) return { ok: false, error: 'invalid' };
  const state = await getOnboardingState(db(), actor);
  const conns = [...(await connectionMap(actor.tenantId, actor.userId)).values()].filter(
    (c) => c.status !== 'broken',
  );
  const source = conns.find((c) => tpl.source.includes(c.connectorId));
  if (!source) return { ok: false, error: 'missingSource' };
  const lookups = await listLookups(db(), actor);
  const def: FlowDefinition = {
    defaultMode: 'test',
    pollMinutes: 5,
    nodes: [{ id: 'src', role: 'source', connectionId: source.id }],
    routes: [],
  };
  for (const connector of tpl.destinations) {
    const dest = conns.find((c) => c.connectorId === connector);
    if (!dest) return { ok: false, error: `missing:${connector}` };
    def.nodes.push({ id: connector, role: 'destination', connectionId: dest.id });
  }
  for (const r of tpl.routes) {
    const dest = conns.find((c) => c.connectorId === r.to)!;
    const accounts = lookups[dest.id]?.accounts ?? [];
    const mapping: Record<string, string> = {};
    if (r.entity === 'order')
      for (const [key, label] of Object.entries(tpl.accountHints ?? {})) {
        const hit = accounts.find((a) => a.label.toLowerCase() === label.toLowerCase());
        if (hit) mapping[key] = hit.value;
      }
    def.routes.push({
      id: `${r.entity.toLowerCase()}-${r.to}`,
      from: 'src',
      to: r.to,
      entity: r.entity,
      targetEntity: r.targetEntity,
      mode: 'test',
      paused: false,
      settings:
        r.entity === 'order'
          ? { 'invoice.bookAutomatically': parsed.data.invoiceMode === 'live' }
          : {},
      mapping,
      categoryAccounts: [],
      filters: [],
      updateExisting: true,
      expressions: {},
      sourceOptions: {},
      tables: {},
      templates: {},
    });
  }
  const flowId =
    state?.flowId ??
    (await createFlow(db(), actor, {
      name: ctx.tenant!.name
        ? `${sourceName(source.connectorId)} → ${tpl.destinations.map(sourceName).join(', ')}`
        : 'Første flow',
      template: tpl.id,
      definition: def,
    }));
  if (state?.flowId) {
    // Back from the test step with another choice: the same draft is updated.
    const draft = await openDraft(db(), actor, flowId);
    await saveDraft(db(), actor, flowId, draft.draftId, def);
  } else await setOnboardingFlow(db(), actor, flowId);
  const runId = await testRun(actor, flowId);
  await advanceOnboarding(db(), actor, 'test');
  redirect(`/onboarding/test?run=${runId}`);
}

function sourceName(connectorId: string) {
  return manifestFor(connectorId)?.name ?? connectorId;
}

async function testRun(actor: Actor, flowId: string): Promise<string> {
  const draft = await openDraft(db(), actor, flowId);
  const { runId } = await requestRun(db(), actor, flowId, 'test', draft.draftId);
  await enqueueRun(actor.tenantId, runId);
  await markFirstTestRun(db(), actor);
  return runId;
}

/* ---- OB4: the test run, choosing a missing account, going live --------------------------------- */

export interface TestRow {
  id: string;
  order: string;
  customer: string;
  amount: number | null;
  account: string | null;
  outcome: 'ready' | 'needsAccount' | 'failed';
  /** The mapping key to fill ("accounts.euB2b") when an account is missing. */
  missingKey: string | null;
  saleKind: string | null;
}

export async function onboardingTestRun(
  runId: string,
): Promise<ActionResult<{ status: string; rows: TestRow[] }>> {
  const { actor } = await owner('test');
  if (!isUuid(runId)) return { ok: false, error: 'invalid' };
  const r = await getRun(db(), actor, runId);
  if (!r) return { ok: false, error: 'NOT_FOUND' };
  const rows: TestRow[] = r.records
    .filter((x) => x.routeId.startsWith('order-'))
    .map((x) => {
      const p = (x.preview ?? {}) as {
        customer?: string;
        total?: number;
        saleKind?: string;
        lines?: { account?: string | null; accountLabel?: string | null }[];
      };
      const missing = x.errorCode === 'ACCOUNT_MISSING' || x.errorCode === 'ACCOUNT_NOT_FOUND';
      const line = p.lines?.[0];
      return {
        id: x.id,
        order: x.label.split(' ')[0] ?? x.label,
        customer: p.customer ?? x.label,
        amount:
          typeof p.total === 'number' ? p.total : x.amountOre !== null ? x.amountOre / 100 : null,
        account: line?.account ? [line.account, line.accountLabel].filter(Boolean).join(' ') : null,
        outcome: missing ? 'needsAccount' : x.outcome === 'failed' ? 'failed' : 'ready',
        missingKey: missing ? ((x.errorParams as { field?: string } | null)?.field ?? null) : null,
        saleKind: p.saleKind ?? null,
      };
    });
  return { ok: true, data: { status: r.run.status, rows } };
}

/** The destination's accounts for "Vælg konto" (from the chart fetched on OB2). */
export async function onboardingAccounts(): Promise<
  ActionResult<{ value: string; label: string }[]>
> {
  const { actor } = await owner('test');
  const state = await getOnboardingState(db(), actor);
  if (!state?.flowId) return { ok: false, error: 'NOT_FOUND' };
  const draft = await openDraft(db(), actor, state.flowId);
  const def = parseDefinition(draft.definition);
  const dest = def?.nodes.find((n) => n.role === 'destination');
  const lookups = await listLookups(db(), actor);
  return { ok: true, data: dest ? (lookups[dest.connectionId]?.accounts ?? []) : [] };
}

const accountSchema = z.object({
  key: z.string().regex(/^accounts\.[A-Za-z][A-Za-z0-9]*$/),
  value: z.string().max(40),
});

/** "Vælg konto" in a row: the account goes into the draft's mapping and the test runs again. */
export async function chooseOnboardingAccount(
  input: unknown,
): Promise<ActionResult<{ runId: string }>> {
  const { actor } = await owner('test');
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const state = await getOnboardingState(db(), actor);
  if (!state?.flowId) return { ok: false, error: 'NOT_FOUND' };
  const draft = await openDraft(db(), actor, state.flowId);
  const def = parseDefinition(draft.definition);
  if (!def) return { ok: false, error: 'invalid' };
  for (const r of def.routes)
    if (r.entity === 'order') r.mapping[parsed.data.key] = parsed.data.value;
  await saveDraft(db(), actor, state.flowId, draft.draftId, def);
  return { ok: true, data: { runId: await testRun(actor, state.flowId) } };
}

/**
 * "Gå live som kladde": the ERP routes go to Kladde (invoices as drafts, nothing booked) or, when
 * the owner chose "Bogfør med det samme" on OB3, to Live; other routes go Live. Validated on the
 * server and published as the flow's first version, which starts with new orders.
 */
export async function goLiveOnboarding(): Promise<ActionResult> {
  const { actor } = await owner('test');
  const state = await getOnboardingState(db(), actor);
  if (!state?.flowId) return { ok: false, error: 'NOT_FOUND' };
  const draft = await openDraft(db(), actor, state.flowId);
  const def = parseDefinition(draft.definition);
  if (!def) return { ok: false, error: 'invalid' };
  const [conns, lookups] = await Promise.all([
    connectionMap(actor.tenantId, actor.userId),
    listLookups(db(), actor),
  ]);
  for (const r of def.routes) {
    // Kladde only where the destination can hold a draft (invoices, not customers).
    const node = def.nodes.find((n) => n.id === r.to);
    const conn = node ? conns.get(node.connectionId) : undefined;
    const manifest = conn ? manifestFor(conn.connectorId) : undefined;
    const port = manifest?.inputs.find((p) => p.entity === r.targetEntity);
    const draftable = manifest?.category === 'erp' && !!port?.modes?.includes('draft');
    r.mode = draftable && r.settings['invoice.bookAutomatically'] !== true ? 'draft' : 'live';
  }
  const findings = validateDefinition(def, {
    connections: Object.fromEntries([...conns.values()].map((x) => [x.id, x])),
    lookups,
    maxDestinations: null,
  });
  if (hasErrors(findings)) return { ok: false, error: 'VALIDATION' };
  await saveDraft(db(), actor, state.flowId, draft.draftId, def);
  await publishDraft(db(), actor, state.flowId, draft.draftId, diffDefinitions(null, def));
  await advanceOnboarding(db(), actor, 'done');
  redirect('/onboarding/done');
}

/** A fresh test run of the onboarding draft (OB4 opened without one, or "Testkør igen"). */
export async function rerunOnboardingTest(): Promise<ActionResult<{ runId: string }>> {
  const { actor } = await owner('test');
  const state = await getOnboardingState(db(), actor);
  if (!state?.flowId) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, data: { runId: await testRun(actor, state.flowId) } };
}

/** How the ERP route will create invoices when going live (OB3's choice). */
export async function onboardingInvoiceMode(): Promise<'draft' | 'live'> {
  const { actor } = await owner('test');
  const state = await getOnboardingState(db(), actor);
  if (!state?.flowId) return 'draft';
  const draft = await openDraft(db(), actor, state.flowId);
  const def = parseDefinition(draft.definition);
  return def?.routes.some(
    (r) => r.entity === 'order' && r.settings['invoice.bookAutomatically'] === true,
  )
    ? 'live'
    : 'draft';
}
