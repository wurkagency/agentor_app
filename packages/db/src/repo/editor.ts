import { and, eq, sql } from 'drizzle-orm';
import { withTenant, type Database } from '../client.js';
import { connectionLookups, flows, flowVersions, tenants } from '../schema/index.js';
import { writeAudit, type Actor } from './audit.js';
import { FlowError } from './flows.js';

/** A draft lock older than this is stale (the editor saves often while open). */
const LOCK_MINUTES = 30;

export interface EditorDraft {
  draftId: string;
  definition: Record<string, unknown>;
  updatedAt: Date;
  /** Someone else holds the lock: the editor opens read-only (D3-Editor-Laest). */
  lockedByOther: string | null;
  published: { id: string; number: number; definition: Record<string, unknown> } | null;
  flowName: string;
}

/**
 * Opens the flow's draft for editing (produktspecifikation §5.4): creates it from the published
 * version if there is none, and takes the one-editor-at-a-time lock unless someone else holds a
 * fresh one.
 */
export async function openDraft(db: Database, actor: Actor, flowId: string): Promise<EditorDraft> {
  return withTenant(db, actor, async (tx) => {
    const [f] = await tx.select().from(flows).where(eq(flows.id, flowId));
    if (!f) throw new FlowError('NOT_FOUND');
    const [pub] = f.publishedVersionId
      ? await tx.select().from(flowVersions).where(eq(flowVersions.id, f.publishedVersionId))
      : [];
    let [draft] = await tx
      .select()
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'draft')));
    if (!draft) {
      [draft] = await tx
        .insert(flowVersions)
        .values({
          tenantId: actor.tenantId,
          flowId,
          state: 'draft',
          definition: pub?.definition ?? { nodes: [], routes: [] },
          authorName: actor.name,
        })
        .returning();
    }
    const stale =
      !draft!.lockedAt || draft!.lockedAt.getTime() < Date.now() - LOCK_MINUTES * 60_000;
    const mine = draft!.lockedBy === actor.userId;
    let lockedByOther: string | null = null;
    if (mine || !draft!.lockedBy || stale) {
      await tx
        .update(flowVersions)
        .set({ lockedBy: actor.userId, lockedByName: actor.name, lockedAt: new Date() })
        .where(eq(flowVersions.id, draft!.id));
    } else lockedByOther = draft!.lockedByName ?? '';
    return {
      draftId: draft!.id,
      definition: draft!.definition,
      updatedAt: draft!.updatedAt,
      lockedByOther,
      published: pub ? { id: pub.id, number: pub.number ?? 0, definition: pub.definition } : null,
      flowName: f.name,
    };
  });
}

/** Saves the draft; only the lock holder can, and saving renews the lock. */
export async function saveDraft(
  db: Database,
  actor: Actor,
  flowId: string,
  draftId: string,
  definition: Record<string, unknown>,
  name?: string,
): Promise<Date> {
  return withTenant(db, actor, async (tx) => {
    const now = new Date();
    const res = await tx
      .update(flowVersions)
      .set({ definition, updatedAt: now, lockedAt: now, authorName: actor.name })
      .where(
        and(
          eq(flowVersions.id, draftId),
          eq(flowVersions.flowId, flowId),
          eq(flowVersions.state, 'draft'),
          sql`(${flowVersions.lockedBy} is null or ${flowVersions.lockedBy} = ${actor.userId})`,
        ),
      )
      .returning({ id: flowVersions.id });
    if (!res.length) throw new FlowError('LOCKED');
    if (name && name.trim())
      await tx
        .update(flows)
        .set({ name: name.trim().slice(0, 120), updatedAt: now })
        .where(eq(flows.id, flowId));
    return now;
  });
}

export async function releaseDraftLock(db: Database, actor: Actor, draftId: string) {
  await withTenant(db, actor, (tx) =>
    tx
      .update(flowVersions)
      .set({ lockedBy: null, lockedByName: null, lockedAt: null })
      .where(and(eq(flowVersions.id, draftId), eq(flowVersions.lockedBy, actor.userId))),
  );
}

/** Kassér kladde: the next edit starts again from the published version. */
export async function discardDraft(db: Database, actor: Actor, flowId: string, draftId: string) {
  await withTenant(db, actor, async (tx) => {
    const res = await tx
      .delete(flowVersions)
      .where(
        and(
          eq(flowVersions.id, draftId),
          eq(flowVersions.flowId, flowId),
          eq(flowVersions.state, 'draft'),
        ),
      )
      .returning({ id: flowVersions.id });
    if (!res.length) throw new FlowError('NOT_FOUND');
    await writeAudit(tx, actor, {
      action: 'flow.draft_discarded',
      objectType: 'flow',
      objectId: flowId,
    });
  });
}

/**
 * Gendan som kladde: copies an earlier version into the draft (overwriting unpublished changes)
 * and takes the lock. Nothing changes for running flows until the draft is published.
 */
export async function restoreVersion(
  db: Database,
  actor: Actor,
  flowId: string,
  versionId: string,
): Promise<string> {
  return withTenant(db, actor, async (tx) => {
    const [v] = await tx
      .select({
        number: flowVersions.number,
        state: flowVersions.state,
        definition: flowVersions.definition,
      })
      .from(flowVersions)
      .where(and(eq(flowVersions.id, versionId), eq(flowVersions.flowId, flowId)));
    if (!v || v.state === 'draft') throw new FlowError('NOT_FOUND');
    const [draft] = await tx
      .select()
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'draft')));
    const now = new Date();
    const lock = { lockedBy: actor.userId, lockedByName: actor.name, lockedAt: now };
    let draftId: string;
    if (draft) {
      const fresh =
        draft.lockedAt && draft.lockedAt.getTime() >= Date.now() - LOCK_MINUTES * 60_000;
      if (draft.lockedBy && draft.lockedBy !== actor.userId && fresh) throw new FlowError('LOCKED');
      const res = await tx
        .update(flowVersions)
        .set({ definition: v.definition, updatedAt: now, authorName: actor.name, ...lock })
        .where(eq(flowVersions.id, draft.id))
        .returning({ id: flowVersions.id });
      // RLS turns an update by someone who can't edit flows into a no-op; say so.
      if (!res.length) throw new FlowError('FORBIDDEN');
      draftId = draft.id;
    } else {
      const [created] = await tx
        .insert(flowVersions)
        .values({
          tenantId: actor.tenantId,
          flowId,
          state: 'draft',
          definition: v.definition,
          authorName: actor.name,
          ...lock,
        })
        .returning({ id: flowVersions.id });
      draftId = created!.id;
    }
    await writeAudit(tx, actor, {
      action: 'flow.version_restored',
      objectType: 'flow',
      objectId: flowId,
      after: { version: v.number },
    });
    return draftId;
  });
}

/** Publishes the draft as the next version (app.publish_flow_version does the swap). */
export async function publishDraft(
  db: Database,
  actor: Actor,
  flowId: string,
  draftId: string,
  changes: unknown[],
): Promise<number> {
  return withTenant(db, actor, async (tx) => {
    const res = await tx.execute<{ n: number }>(
      sql`select app.publish_flow_version(${flowId}, ${draftId}, ${JSON.stringify(changes)}::jsonb, ${actor.name}) as n`,
    );
    // The activation metric (§7.9): the first test run, set by the test-run action.
    return res.rows[0]!.n;
  });
}

/** New flow from a template or blank (D4): the draft is all there is until it is published. */
export async function createFlow(
  db: Database,
  actor: Actor,
  input: { name: string; template: string | null; definition: Record<string, unknown> },
): Promise<string> {
  return withTenant(db, actor, async (tx) => {
    const [f] = await tx
      .insert(flows)
      .values({
        tenantId: actor.tenantId,
        name: input.name.slice(0, 120),
        template: input.template,
      })
      .returning({ id: flows.id });
    await tx.insert(flowVersions).values({
      tenantId: actor.tenantId,
      flowId: f!.id,
      state: 'draft',
      definition: input.definition,
      authorName: actor.name,
      lockedBy: actor.userId,
      lockedByName: actor.name,
      lockedAt: new Date(),
    });
    await writeAudit(tx, actor, {
      action: 'flow.created',
      objectType: 'flow',
      objectId: f!.id,
      after: { name: input.name, template: input.template },
    });
    return f!.id;
  });
}

/** Records the first test run (activation metric, §7.9). */
export async function markFirstTestRun(db: Database, actor: Actor) {
  await withTenant(db, actor, (tx) =>
    tx
      .update(tenants)
      .set({ firstTestRunAt: new Date() })
      .where(sql`${tenants.firstTestRunAt} is null and ${tenants.id} = ${actor.tenantId}`),
  );
}

/** Live lookup lists per connection (chart of accounts), as the worker cached them. */
export async function listLookups(db: Database, ctx: { tenantId: string; userId: string }) {
  const rows = await withTenant(db, ctx, (tx) => tx.select().from(connectionLookups));
  const out: Record<
    string,
    Partial<Record<string, { value: string; label: string; vatCode?: string }[]>>
  > = {};
  for (const r of rows) (out[r.connectionId] ??= {})[r.list] = r.options;
  return out;
}
