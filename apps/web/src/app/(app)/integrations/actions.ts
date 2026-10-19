'use server';

import {
  FlowError,
  isUuid,
  requestRun,
  restoreVersion,
  setFlowPaused,
  setRoutePaused,
} from '@agentor/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { enqueueRun } from '@/server/runs';

/** Owners, admins and developers run and pause flows; readers only look (D11). */
const EDITORS = ['owner', 'admin', 'developer'] as const;

const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= 100 && v.every(isUuid) ? (v as string[]) : null;

async function each(
  flowIds: unknown,
  fn: (actor: Awaited<ReturnType<typeof actorFor>>, id: string) => Promise<void>,
): Promise<ActionResult<{ done: number }>> {
  const ctx = await requireRole(EDITORS);
  const list = ids(flowIds);
  if (!list) return { ok: false, error: 'invalid' };
  const actor = await actorFor(ctx);
  let done = 0;
  for (const id of list) {
    try {
      await fn(actor, id);
      done++;
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: { done } };
}

export async function pauseFlows(flowIds: unknown) {
  return each(flowIds, (actor, id) => setFlowPaused(db(), actor, id, true));
}

export async function resumeFlows(flowIds: unknown) {
  return each(flowIds, (actor, id) => setFlowPaused(db(), actor, id, false));
}

/** Kør nu: a manual run of the published version. Drafts and paused flows are skipped. */
export async function runFlowsNow(flowIds: unknown) {
  return each(flowIds, async (actor, id) => {
    const { runId } = await requestRun(db(), actor, id, 'manual');
    await enqueueRun(actor.tenantId, runId);
  });
}

/** Gentag: retries the open failures of a flow (optionally on one route). */
export async function retryFailures(
  flowId: string,
  routeId?: string,
): Promise<ActionResult<{ runId: string }>> {
  const ctx = await requireRole(EDITORS);
  if (!isUuid(flowId) || (routeId && !/^[a-z0-9-]{1,40}$/.test(routeId)))
    return { ok: false, error: 'invalid' };
  const actor = await actorFor(ctx);
  try {
    const { runId } = await requestRun(db(), actor, flowId, 'retry');
    await enqueueRun(actor.tenantId, runId, { routeId });
    revalidatePath('/', 'layout');
    return { ok: true, data: { runId } };
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function setRoutePause(
  flowId: string,
  routeId: string,
  paused: boolean,
): Promise<ActionResult> {
  const ctx = await requireRole(EDITORS);
  if (!isUuid(flowId)) return { ok: false, error: 'invalid' };
  try {
    await setRoutePaused(db(), await actorFor(ctx), flowId, routeId, paused);
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Gendan som kladde: an earlier version becomes the draft, then the editor opens on it. */
export async function restoreVersionAction(
  flowId: string,
  versionId: string,
): Promise<ActionResult> {
  const ctx = await requireRole(EDITORS);
  if (!isUuid(flowId) || !isUuid(versionId)) return { ok: false, error: 'invalid' };
  try {
    await restoreVersion(db(), await actorFor(ctx), flowId, versionId);
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
  redirect(`/integrations/${flowId}/editor`);
}
