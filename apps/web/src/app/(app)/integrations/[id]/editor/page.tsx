import { isUuid, listActivity, listLookups, openDraft, openFailures } from '@agentor/db';
import { formatTime } from '@agentor/i18n';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { actorFor } from '@/server/actor';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { Editor } from './editor';

export async function generateMetadata() {
  const t = await getTranslations('editor');
  return { title: t('title') };
}

/**
 * Flow editor (D3–D6): canvas or list, inspector per route, validation and test run, publish.
 * Readers and users without the lock see it read-only.
 */
export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ route?: string; tab?: string; field?: string; guide?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const views = await viewsFor(ctx);
  const view = views.find((v) => v.id === id);
  if (!view) notFound();
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [conns, lookups, billing, failures] = await Promise.all([
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    listLookups(db(), c),
    billingOverview(ctx),
    openFailures(db(), c, id),
  ]);
  const draft = canEdit ? await openDraft(db(), await actorFor(ctx), id) : null;
  const definition = draft?.definition ?? view.published?.definition ?? { nodes: [], routes: [] };
  const recent = await listActivity(db(), c, {
    flowId: id,
    since: new Date(Date.now() - 7 * 86_400_000),
    limit: 200,
  });
  const locale = (await getLocale()) as 'da' | 'en';
  return (
    <Editor
      flow={{ id, name: view.name, template: view.template }}
      draft={draft ? { id: draft.draftId, updatedAt: draft.updatedAt.toISOString() } : null}
      initial={definition}
      published={
        view.published
          ? { number: view.published.number, definition: view.published.definition }
          : null
      }
      readOnly={!canEdit ? 'role' : draft?.lockedByOther ? 'locked' : null}
      lockedBy={draft?.lockedByOther ?? null}
      connections={[...conns.values()].map((x) => ({
        id: x.id,
        connectorId: x.connectorId,
        name: x.name,
        status: x.status,
      }))}
      lookups={lookups}
      plan={{
        name: billing?.plan.name ?? '',
        maxDestinations: billing?.plan.entitlements.destinationsPerFlow ?? null,
        minPollMinutes: billing?.plan.entitlements.pollingIntervalMinutes ?? 5,
        isOwner: ctx.tenant.role === 'owner',
      }}
      routeStats={Object.fromEntries(
        view.routes.map((r) => [
          r.id,
          { records: r.records, status: r.status, openFailures: r.openFailures },
        ]),
      )}
      openFailures={new Set(failures.map((f) => `${f.routeId}:${f.sourceId}`)).size}
      history={recent.map((r) => ({
        id: r.id,
        routeId: r.routeId,
        label: r.label,
        outcome: r.outcome,
        mode: r.mode,
        time: formatTime(r.createdAt, locale),
      }))}
      focus={{ route: sp.route ?? null, tab: sp.tab ?? null, field: sp.field ?? null }}
      guide={sp.guide === '1'}
    />
  );
}
