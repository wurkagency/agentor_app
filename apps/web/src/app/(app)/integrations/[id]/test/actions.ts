'use server';

import { FlowError, isUuid, markFirstTestRun, requestRun } from '@agentor/db';
import { actorFor, type ActionResult } from '@/server/actor';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { enqueueRun } from '@/server/runs';

/**
 * Testkør on mobile (MA22): the stored draft as it is, against the latest 10 records without
 * writing. Unlike the editor's startTestRun nothing is saved first, so the draft lock is left
 * alone; the results are read with the editor's getTestRun.
 */
export async function testDraftAction(
  flowId: string,
  draftId: string,
): Promise<ActionResult<{ runId: string }>> {
  const ctx = await requireRole(['owner', 'admin', 'developer'], { support: true });
  if (!isUuid(flowId) || !isUuid(draftId)) return { ok: false, error: 'invalid' };
  const actor = await actorFor(ctx);
  try {
    const { runId } = await requestRun(db(), actor, flowId, 'test', draftId);
    await enqueueRun(actor.tenantId, runId);
    await markFirstTestRun(db(), actor);
    return { ok: true, data: { runId } };
  } catch (e) {
    if (e instanceof FlowError) return { ok: false, error: e.code };
    throw e;
  }
}
