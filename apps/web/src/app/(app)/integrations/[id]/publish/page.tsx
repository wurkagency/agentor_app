import { getRun, isUuid, listLookups, openFailures } from '@agentor/db';
import { parseDefinition } from '@agentor/flows';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ConnMap } from '@/components/editor/model';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireAppContext } from '@/server/auth/session';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { PublishMobile } from './publish-mobile';

export async function generateMetadata() {
  const t = await getTranslations('editor');
  return { title: t('publish.publish') };
}

/**
 * MA23 Publicér: the open draft as the next version, with the same change list, invoice choice,
 * confirmation and retry offer as the editor's dialog (D5-GaaLive) and the same publishAction.
 * `?run=` is the test run from MA22, for "testkørsel uden fejl".
 */
export default async function PublishPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const f = (await viewsFor(ctx)).find((v) => v.id === id);
  if (!f) notFound();
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const runId = (await searchParams).run;
  const [conns, lookups, failures, detail] = await Promise.all([
    connectionMap(ctx.tenant.tenantId, ctx.user.id),
    listLookups(db(), c),
    openFailures(db(), c, id),
    runId && isUuid(runId) ? getRun(db(), c, runId) : Promise.resolve(null),
  ]);
  const tested =
    detail &&
    detail.run.flowId === id &&
    detail.run.kind === 'test' &&
    detail.run.versionId === f.draft?.id &&
    detail.run.status !== 'queued' &&
    detail.run.status !== 'running'
      ? {
          clean: !detail.records.some((r) => r.outcome === 'failed'),
          at: (detail.run.finishedAt ?? detail.run.startedAt ?? new Date()).toISOString(),
        }
      : null;
  let published: { number: number; definition: ReturnType<typeof parseDefinition> } | null = null;
  if (f.published)
    try {
      published = {
        number: f.published.number,
        definition: parseDefinition(f.published.definition),
      };
    } catch {
      published = null;
    }
  const connMap: ConnMap = Object.fromEntries(
    [...conns.values()].map((x) => [
      x.id,
      { id: x.id, connectorId: x.connectorId, name: x.name, status: x.status },
    ]),
  );
  const t = await getTranslations('mobile.flow');
  return (
    <Responsive
      desktop={
        <DesktopRedirect
          href={`/integrations/${id}/editor`}
          label={t('publish', { n: (f.published?.number ?? 0) + 1 })}
        />
      }
      mobile={
        <PublishMobile
          flow={{ id, name: f.name }}
          draft={
            f.draft?.definition && f.draft
              ? { id: f.draft.id, definition: f.draft.definition }
              : null
          }
          published={published}
          conns={connMap}
          lookups={lookups}
          openFailures={new Set(failures.map((x) => `${x.routeId}:${x.sourceId}`)).size}
          tested={tested}
          canEdit={canEdit}
        />
      }
    />
  );
}
