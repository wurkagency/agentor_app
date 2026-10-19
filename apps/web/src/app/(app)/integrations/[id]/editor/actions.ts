'use server';

import {
  discardDraft,
  FlowError,
  getRun,
  isUuid,
  markFirstTestRun,
  openFailures,
  publishDraft,
  releaseDraftLock,
  requestRun,
  saveDraft,
  listLookups,
} from '@agentor/db';
import { diffDefinitions, hasErrors, parseDefinition, validateDefinition } from '@agentor/flows';
import { revalidatePath } from 'next/cache';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { enqueueRun } from '@/server/runs';

const EDITORS = ['owner', 'admin', 'developer'] as const;

function ids(flowId: unknown, draftId: unknown) {
  return isUuid(flowId) && isUuid(draftId);
}

function parse(raw: unknown) {
  try {
    return parseDefinition(raw);
  } catch {
    return null;
  }
}

export async function saveDraftAction(
  flowId: string,
  draftId: string,
  definition: unknown,
  name?: string,
): Promise<ActionResult<{ savedAt: string }>> {
  const ctx = await requireRole(EDITORS, { support: true });
  if (!ids(flowId, draftId)) return { ok: false, error: 'invalid' };
  const def = parse(definition);
  if (!def) return { ok: false, error: 'invalid' };
  // Only connections of this tenant can be referenced (RLS hides the rest).
  const conns = await connectionMap(ctx.tenant.tenantId, ctx.user.id);
  if (def.nodes.some((n) => !conns.has(n.connectionId))) return { ok: false, error: 'invalid' };
  try {
    const at = await saveDraft(db(), await actorFor(ctx), flowId, draftId, def, name);
    return { ok: true, data: { savedAt: at.toISOString() } };
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
}

/** Testkør (D5): saves the draft and runs it against the latest 10 records without writing. */
export async function startTestRun(
  flowId: string,
  draftId: string,
  definition: unknown,
): Promise<ActionResult<{ runId: string }>> {
  const saved = await saveDraftAction(flowId, draftId, definition);
  if (!saved.ok) return saved;
  const ctx = await requireRole(EDITORS, { support: true });
  const actor = await actorFor(ctx);
  const { runId } = await requestRun(db(), actor, flowId, 'test', draftId);
  await enqueueRun(actor.tenantId, runId);
  await markFirstTestRun(db(), actor);
  return { ok: true, data: { runId } };
}

export interface TestRunRecord {
  id: string;
  routeId: string;
  label: string;
  outcome: string;
  amountOre: number | null;
  errorCode: string | null;
  errorParams: Record<string, string> | null;
  skipReason: string | null;
  preview: unknown;
}

export async function getTestRun(
  runId: string,
): Promise<ActionResult<{ status: string; records: TestRunRecord[] }>> {
  const ctx = await requireRole(EDITORS, { support: true });
  if (!isUuid(runId)) return { ok: false, error: 'invalid' };
  const r = await getRun(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id }, runId);
  if (!r) return { ok: false, error: 'NOT_FOUND' };
  return {
    ok: true,
    data: {
      status: r.run.status,
      records: r.records.map((x) => ({
        id: x.id,
        routeId: x.routeId,
        label: x.label,
        outcome: x.outcome,
        amountOre: x.amountOre,
        errorCode: x.errorCode,
        errorParams: x.errorParams,
        skipReason: x.skipReason,
        preview: x.preview,
      })),
    },
  };
}

/**
 * Publicér (D5-GaaLive): saves, re-validates on the server, publishes the next version and, if
 * asked, retries the records that failed on the previous version.
 */
export async function publishAction(
  flowId: string,
  draftId: string,
  definition: unknown,
  opts: { retryFailures: boolean },
): Promise<ActionResult<{ version: number; retried: boolean }>> {
  const saved = await saveDraftAction(flowId, draftId, definition);
  if (!saved.ok) return saved;
  const ctx = await requireRole(EDITORS, { support: true });
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const def = parse(definition)!;
  const [conns, lookups, billing] = await Promise.all([
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    listLookups(db(), c),
    billingOverview(ctx),
  ]);
  const findings = validateDefinition(def, {
    connections: Object.fromEntries([...conns.values()].map((x) => [x.id, x])),
    lookups,
    maxDestinations: billing?.plan.entitlements.destinationsPerFlow ?? null,
  });
  if (hasErrors(findings)) return { ok: false, error: 'VALIDATION' };
  const actor = await actorFor(ctx);
  const views = await viewsFor(ctx);
  const before = views.find((v) => v.id === flowId)?.published?.definition;
  const changes = diffDefinitions(before ? parse(before) : null, def);
  let version: number;
  try {
    version = await publishDraft(db(), actor, flowId, draftId, changes);
  } catch (e) {
    const msg =
      e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : '';
    if (msg.includes('DRAFT_NOT_FOUND')) return { ok: false, error: 'LOCKED' };
    throw e;
  }
  let retried = false;
  if (opts.retryFailures && (await openFailures(db(), c, flowId)).length > 0) {
    const { runId } = await requestRun(db(), actor, flowId, 'retry');
    await enqueueRun(actor.tenantId, runId, {});
    retried = true;
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: { version, retried } };
}

export async function discardDraftAction(flowId: string, draftId: string): Promise<ActionResult> {
  const ctx = await requireRole(EDITORS, { support: true });
  if (!ids(flowId, draftId)) return { ok: false, error: 'invalid' };
  try {
    await discardDraft(db(), await actorFor(ctx), flowId, draftId);
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function releaseLockAction(draftId: string): Promise<void> {
  const ctx = await requireRole(EDITORS, { support: true });
  if (isUuid(draftId)) await releaseDraftLock(db(), await actorFor(ctx), draftId);
}
