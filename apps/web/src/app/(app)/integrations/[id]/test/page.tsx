import { getRun, isUuid } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ConnMap } from '@/components/editor/model';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireAppContext } from '@/server/auth/session';
import { connectionMap, viewsFor } from '@/server/flows';
import { db } from '@/server/infra';
import { TestRunMobile } from './test-mobile';

export async function generateMetadata() {
  const t = await getTranslations('mobile.testRun');
  return { title: t('title') };
}

/**
 * MA22 Testkørsel: the open draft against the latest 10 records, per route and record. Opened
 * from "Testkør" on MA20; `?run=` keeps the result on reload. On a computer the editor's bottom
 * panel (D5-Testkoersel) does the same.
 */
export default async function TestRunPage({
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
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  const conns = await connectionMap(ctx.tenant.tenantId, ctx.user.id);
  const runId = (await searchParams).run;
  const detail =
    runId && isUuid(runId)
      ? await getRun(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id }, runId)
      : null;
  const run =
    detail && detail.run.flowId === id && detail.run.kind === 'test'
      ? {
          runId: detail.run.id,
          status: detail.run.status,
          records: detail.records.map((x) => ({
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
        }
      : null;
  const connMap: ConnMap = Object.fromEntries(
    [...conns.values()].map((x) => [
      x.id,
      { id: x.id, connectorId: x.connectorId, name: x.name, status: x.status },
    ]),
  );
  const t = await getTranslations('mobile.testRun');
  return (
    <Responsive
      desktop={<DesktopRedirect href={`/integrations/${id}/editor`} label={t('title')} />}
      mobile={
        <TestRunMobile
          flow={{ id, name: f.name }}
          draftId={f.draft?.id ?? null}
          def={f.draft?.definition ?? null}
          conns={connMap}
          sourceName={f.source?.name ?? ''}
          nextVersion={(f.published?.number ?? 0) + 1}
          canEdit={canEdit}
          initial={run}
        />
      }
    />
  );
}
